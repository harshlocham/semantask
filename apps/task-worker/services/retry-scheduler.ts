import mongoose from "mongoose";
import TaskModel, { type ITask } from "@semantask/db/models/Task";
import * as dbModule from "@semantask/db";
import { enqueueOutboxEvent } from "@semantask/services/outbox.service";
import type { TaskExecutionActionType } from "@semantask/types";
import * as taskRepo from "@semantask/services/repositories/task.repo";
import { isMongoTransactionUnsupported } from "@semantask/services/mongo-transaction";
import { emitRetryDueShadowState } from "./retry-shadow.js";

const connectToDatabase =
    (dbModule as unknown as { connectToDatabase?: () => Promise<unknown> }).connectToDatabase
    || ((dbModule as unknown as { default?: { connectToDatabase?: () => Promise<unknown> } }).default?.connectToDatabase)
    || (async () => undefined);

export const RETRY_SCAN_INTERVAL_MS = Number(process.env.TASK_RETRY_SCAN_INTERVAL_MS || 5000);

function buildRetryPayload(task: ITask): Record<string, unknown> {
    const taskId = task._id.toString();
    const conversationId = task.conversationId.toString();
    const triggerMessageId = task.sourceMessageIds?.[0]?.toString() ?? taskId;

    return {
        taskId,
        conversationId,
        triggerMessageId,
        requestedByType: "system",
        requestedById: null,
        actionType: "none" as TaskExecutionActionType,
        parameters: {},
        confidence: typeof task.confidence === "number" ? task.confidence : 0.8,
        needsApproval: false,
        isRetry: true,
        retryCount: task.retryCount ?? 0,
    };
}

const RETRY_CANDIDATE_FILTER = (now: Date) => ({
    lifecycleState: "retry_scheduled" as const,
    nextRetryAt: { $lte: now },
    $or: [
        { leaseOwner: null },
        { leaseExpiresAt: { $lt: now } },
    ],
});

async function claimRetryCandidate(now: Date, session?: mongoose.ClientSession): Promise<ITask | null> {
    return TaskModel.findOneAndUpdate(
        RETRY_CANDIDATE_FILTER(now),
        {
            $set: {
                lifecycleState: "ready",
                lastRetryAt: now,
            },
        },
        {
            sort: { nextRetryAt: 1 },
            new: true,
            session,
        },
    ).exec();
}

async function revertRetryClaim(
    taskId: mongoose.Types.ObjectId,
    session?: mongoose.ClientSession,
): Promise<void> {
    await TaskModel.findOneAndUpdate(
        { _id: taskId, lifecycleState: "ready" },
        { $set: { lifecycleState: "retry_scheduled" } },
        { session },
    ).exec();
}

async function enqueueRetryForCandidate(
    candidate: ITask,
    workerId: string,
    now: Date,
    session?: mongoose.ClientSession,
): Promise<void> {
    const retryCount = candidate.retryCount ?? 0;

    await enqueueOutboxEvent({
        topic: "task.execution.requested",
        dedupeKey: `task.execution.requested:${candidate._id.toString()}:retry:${retryCount}`,
        payload: buildRetryPayload(candidate),
        session,
    });

    await taskRepo.createTaskAction({
        taskId: candidate._id.toString(),
        conversationId: candidate.conversationId.toString(),
        actorType: "system",
        actorId: null,
        actionType: "none",
        toolName: null,
        messageId: candidate.sourceMessageIds?.[0]?.toString() ?? null,
        parameters: { retryCount },
        executionState: "queued",
        summary: `Autonomous retry #${retryCount} enqueued.`,
        error: null,
        patch: { before: null, after: { retryCount, lastRetryReason: candidate.lastRetryReason } },
        reason: candidate.lastRetryReason ?? "Scheduled retry",
        idempotencyKey: `task.execution.requested:${candidate._id.toString()}:retry:${retryCount}:action`,
    }).catch((error: unknown) => {
        const maybeMongo = error as { code?: number };
        if (maybeMongo?.code !== 11000) {
            throw error;
        }
    });

    console.info("task-worker retry.enqueued", {
        workerId,
        taskId: candidate._id.toString(),
        retryCount,
        runId: candidate.executionRunId ?? null,
    });

    await emitRetryDueShadowState({
        taskId: candidate._id.toString(),
        queuedAt: now.toISOString(),
        workerId,
        source: "runRetryScannerOnce",
    });
}

async function promoteAndEnqueueRetry(workerId: string, now: Date, session?: mongoose.ClientSession): Promise<number> {
    const candidate = await claimRetryCandidate(now, session);
    if (!candidate) {
        return 0;
    }

    try {
        await enqueueRetryForCandidate(candidate, workerId, now, session);
    } catch (error) {
        // Without a transaction, the lifecycle claim above is already committed.
        // Restore retry_scheduled so a failed enqueue can be picked up again.
        if (!session) {
            try {
                await revertRetryClaim(candidate._id);
            } catch (revertError) {
                console.error("task-worker retry.revert_claim_failed", {
                    workerId,
                    taskId: candidate._id.toString(),
                    error: revertError instanceof Error ? revertError.message : String(revertError),
                });
            }
        }

        throw error;
    }

    return 1;
}

export async function runRetryScannerOnce(workerId: string): Promise<number> {
    await connectToDatabase();

    const now = new Date();
    const session = await mongoose.startSession();

    try {
        let enqueued = 0;

        try {
            await session.withTransaction(async () => {
                enqueued = await promoteAndEnqueueRetry(workerId, now, session);
            });
        } catch (error) {
            if (!isMongoTransactionUnsupported(error)) {
                throw error;
            }

            enqueued = await promoteAndEnqueueRetry(workerId, now);
        }

        return enqueued;
    } finally {
        await session.endSession();
    }
}

export function startRetryScheduler(workerId: string): () => void {
    let stopped = false;

    const tick = async () => {
        if (stopped) {
            return;
        }

        try {
            await runRetryScannerOnce(workerId);
        } catch (error) {
            console.error("task-worker retry.scanner_failed", {
                workerId,
                error: error instanceof Error ? error.message : String(error),
            });
        }

        if (!stopped) {
            setTimeout(tick, RETRY_SCAN_INTERVAL_MS);
        }
    };

    void tick();

    return () => {
        stopped = true;
    };
}
