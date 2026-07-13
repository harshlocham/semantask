import TaskModel, { type ITask } from "@semantask/db/models/Task";
import * as dbModule from "@semantask/db";
import type { TaskExecutionUpdatedPayload, TaskResult } from "@semantask/types";
import { taskStuckDetectedCounter } from "@semantask/observability/metrics";
import { DEFAULT_LEASE_MS, getLeaseRenewalIntervalMs } from "./task-lease.js";
import { scheduleTaskRetry } from "./schedule-retry.js";
import { logExecution } from "./execution-logger.js";

const connectToDatabase =
    (dbModule as unknown as { connectToDatabase?: () => Promise<unknown> }).connectToDatabase
    || ((dbModule as unknown as { default?: { connectToDatabase?: () => Promise<unknown> } }).default?.connectToDatabase)
    || (async () => undefined);

export const STUCK_DETECTION_INTERVAL_MS = Number(process.env.TASK_STUCK_DETECTION_INTERVAL_MS || 60000);
export const STUCK_ERROR_MESSAGE = "Task execution stalled: heartbeat timeout.";

export type StuckRemediationMode = "log" | "fail" | "retry";

export type StuckRemediationOutcome = "logged" | "failed" | "retry_scheduled" | "retry_exhausted" | "skipped";

export type StuckTaskSnapshot = {
    _id: { toString(): string };
    conversationId: { toString(): string };
    executionRunId?: string | null;
    leaseOwner?: string | null;
    lastHeartbeatAt?: Date | null;
    retryCount?: number;
    maxRetries?: number;
    version: number;
    status: string;
    lifecycleState?: string;
    progress?: number;
    result?: TaskResult;
    cancelRequestedAt?: Date | null;
    cancelReason?: string | null;
};

export type StuckTaskDetectorHooks = {
    onTaskUpdated?: (task: StuckTaskSnapshot, conversationId: string) => Promise<void>;
    onExecutionUpdate?: (payload: TaskExecutionUpdatedPayload) => Promise<void>;
};

export function getStuckRemediationMode(): StuckRemediationMode {
    const raw = (process.env.TASK_STUCK_REMEDIATION || "log").trim().toLowerCase();
    if (raw === "fail" || raw === "retry") {
        return raw;
    }

    return "log";
}

/** Default: 2× lease renewal interval (per roadmap acceptance). Override with TASK_STUCK_HEARTBEAT_MS. */
export function getStuckHeartbeatCutoffMs(): number {
    const configured = Number(process.env.TASK_STUCK_HEARTBEAT_MS);
    if (Number.isFinite(configured) && configured > 0) {
        return configured;
    }

    return 2 * getLeaseRenewalIntervalMs(DEFAULT_LEASE_MS);
}

function buildStuckFailureResult(lastHeartbeatAt?: Date | null): TaskResult {
    return {
        success: false,
        confidence: 0,
        evidence: {
            reason: "stuck",
            lastHeartbeatAt: lastHeartbeatAt?.toISOString() ?? null,
        },
        error: STUCK_ERROR_MESSAGE,
    };
}

export async function remediateStuckTask(
    task: StuckTaskSnapshot,
    workerId: string,
    mode: StuckRemediationMode,
    cutoff: Date,
    hooks?: StuckTaskDetectorHooks,
): Promise<StuckRemediationOutcome> {
    if (task.cancelRequestedAt) {
        return "skipped";
    }

    const taskId = task._id.toString();
    const conversationId = task.conversationId.toString();

    logExecution("warn", {
        event: "stuck_task.detected",
        workerId,
        taskId,
        runId: task.executionRunId ?? undefined,
        leaseOwner: task.leaseOwner ?? undefined,
        lastHeartbeatAt: task.lastHeartbeatAt?.toISOString(),
        remediationMode: mode,
    });

    if (mode === "log") {
        taskStuckDetectedCounter.inc({ remediation: "logged" });
        return "logged";
    }

    if (mode === "fail") {
        const updated = await TaskModel.findOneAndUpdate(
            {
                _id: taskId,
                lifecycleState: "executing",
                cancelRequestedAt: null,
                lastHeartbeatAt: { $lt: cutoff },
            },
            {
                $set: {
                    lifecycleState: "failed",
                    status: "failed",
                    leaseOwner: null,
                    leaseExpiresAt: null,
                    progress: 100,
                    result: buildStuckFailureResult(task.lastHeartbeatAt),
                    lastRetryReason: "stuck_task_remediation",
                },
            },
            { new: true },
        ).exec();

        if (!updated) {
            return "skipped";
        }

        logExecution("info", {
            event: "stuck_task.remediated",
            workerId,
            taskId,
            action: "fail",
            runId: updated.executionRunId ?? undefined,
        });

        const snapshot: StuckTaskSnapshot = {
            _id: updated._id,
            conversationId: updated.conversationId,
            version: updated.version,
            status: updated.status,
            lifecycleState: updated.lifecycleState,
            progress: updated.progress,
            result: updated.result ?? undefined,
            cancelRequestedAt: updated.cancelRequestedAt ?? null,
            cancelReason: updated.cancelReason ?? null,
        };

        await hooks?.onTaskUpdated?.(snapshot, conversationId);
        await hooks?.onExecutionUpdate?.({
            taskId,
            conversationId,
            state: "failed",
            actionType: "none",
            summary: "Task failed after heartbeat timeout.",
            error: STUCK_ERROR_MESSAGE,
            updatedAt: new Date().toISOString(),
            runId: updated.executionRunId ?? undefined,
            phase: "finalize",
            step: "stuck_remediation_failed",
            progress: 100,
        });

        taskStuckDetectedCounter.inc({ remediation: "failed" });
        return "failed";
    }

    const claimed = await TaskModel.findOneAndUpdate(
        {
            _id: taskId,
            lifecycleState: "executing",
            cancelRequestedAt: null,
            lastHeartbeatAt: { $lt: cutoff },
        },
        {
            $set: {
                leaseOwner: null,
                leaseExpiresAt: null,
            },
        },
        { new: true },
    ).exec();

    if (!claimed) {
        return "skipped";
    }

    const retryResult = await scheduleTaskRetry(
        claimed as unknown as ITask & { save(): Promise<void> },
        new Error(STUCK_ERROR_MESSAGE),
        {
            runId: claimed.executionRunId ?? null,
            emit: hooks?.onExecutionUpdate,
        },
    );

    const outcome: StuckRemediationOutcome = retryResult.outcome === "scheduled"
        ? "retry_scheduled"
        : "retry_exhausted";

    logExecution("info", {
        event: "stuck_task.remediated",
        workerId,
        taskId,
        action: "retry",
        retryOutcome: retryResult.outcome,
        retryCount: retryResult.retryCount,
        runId: claimed.executionRunId ?? undefined,
    });

    const refreshed = await TaskModel.findById(taskId).exec();
    if (refreshed) {
        await hooks?.onTaskUpdated?.({
            _id: refreshed._id,
            conversationId: refreshed.conversationId,
            version: refreshed.version,
            status: refreshed.status,
            lifecycleState: refreshed.lifecycleState,
            progress: refreshed.progress,
            result: refreshed.result ?? undefined,
            cancelRequestedAt: refreshed.cancelRequestedAt ?? null,
            cancelReason: refreshed.cancelReason ?? null,
        }, conversationId);
    }

    taskStuckDetectedCounter.inc({ remediation: outcome });
    return outcome;
}

export async function detectStuckTasksOnce(
    workerId: string,
    hooks?: StuckTaskDetectorHooks,
): Promise<number> {
    await connectToDatabase();

    const cutoff = new Date(Date.now() - getStuckHeartbeatCutoffMs());
    const mode = getStuckRemediationMode();
    const stuck = await TaskModel.find({
        lifecycleState: "executing",
        lastHeartbeatAt: { $lt: cutoff },
        cancelRequestedAt: null,
    })
        .select({
            _id: 1,
            conversationId: 1,
            executionRunId: 1,
            leaseOwner: 1,
            lastHeartbeatAt: 1,
            retryCount: 1,
            maxRetries: 1,
            version: 1,
            status: 1,
            lifecycleState: 1,
            progress: 1,
            result: 1,
            cancelRequestedAt: 1,
            cancelReason: 1,
        })
        .limit(20)
        .lean()
        .exec();

    for (const task of stuck) {
        await remediateStuckTask(task as StuckTaskSnapshot, workerId, mode, cutoff, hooks);
    }

    return stuck.length;
}

export function startStuckTaskDetector(workerId: string, hooks?: StuckTaskDetectorHooks): () => void {
    let stopped = false;

    const tick = async () => {
        if (stopped) {
            return;
        }

        try {
            await detectStuckTasksOnce(workerId, hooks);
        } catch (error) {
            logExecution("error", {
                event: "stuck_task.scanner_failed",
                workerId,
                error: error instanceof Error ? error.message : String(error),
            });
        }

        if (!stopped) {
            setTimeout(tick, STUCK_DETECTION_INTERVAL_MS);
        }
    };

    void tick();

    return () => {
        stopped = true;
    };
}
