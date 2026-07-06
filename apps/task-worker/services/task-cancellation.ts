import TaskModel, { type ITask, type TaskLifecycleState } from "@semantask/db/models/Task";
import type { ExecutionActorType, ExecutionEvent, ExecutionState, TaskResult } from "@semantask/types";
import { deriveLegacyLifecycleState } from "@semantask/types";
import {
    appendShadowHistory,
    isExecutionState,
    reduceShadowExecutionEvent,
    resolveCurrentShadowState,
    type ShadowExecutionStateHistoryEntry,
} from "./execution-state-shadow.js";
import { logExecution } from "./execution-logger.js";
import { maybeLogTaskStateDivergence } from "./state-divergence-check.js";
import { releaseTaskLease } from "./task-lease.js";

export type TaskCancelRequestedPayload = {
    taskId: string;
    conversationId: string;
    reason: string;
    initiatedBy: ExecutionActorType;
    initiatedById: string | null;
    requestedAt: string;
};

type MutableTaskDocument = ITask & {
    save(): Promise<unknown>;
};

const TERMINAL_LIFECYCLE: TaskLifecycleState[] = ["completed", "failed"];

export function isTaskTerminal(task: Pick<ITask, "lifecycleState" | "status">): boolean {
    return TERMINAL_LIFECYCLE.includes(task.lifecycleState)
        || task.status === "completed"
        || task.status === "failed";
}

export function isTaskCancellationRequested(task: Pick<ITask, "cancelRequestedAt">): boolean {
    return task.cancelRequestedAt instanceof Date;
}

export function isTaskActivelyLeased(task: Pick<ITask, "leaseOwner" | "leaseExpiresAt">, now = new Date()): boolean {
    return Boolean(
        task.leaseOwner
        && task.leaseExpiresAt instanceof Date
        && task.leaseExpiresAt > now,
    );
}

function isShadowCancellationEnabled(): boolean {
    return process.env.TASK_EXECUTION_FSM_SHADOW_MODE !== "0";
}

function buildCancelResult(reason: string): TaskResult {
    return {
        success: false,
        confidence: 0,
        evidence: { reason: "cancelled" },
        error: reason,
    };
}

async function applyShadowCancellationEvents(
    task: MutableTaskDocument,
    events: ExecutionEvent[],
    workerId?: string,
    source?: string,
): Promise<ExecutionState | null> {
    if (!isShadowCancellationEnabled() || events.length === 0) {
        return null;
    }

    let current = resolveCurrentShadowState(task.executionState);
    let history: ShadowExecutionStateHistoryEntry[] = (
        Array.isArray(task.stateHistory) ? task.stateHistory : []
    ) as unknown as ShadowExecutionStateHistoryEntry[];

    for (const event of events) {
        const result = reduceShadowExecutionEvent({
            current,
            event,
            workerId: workerId ?? null,
        });

        current = result.to;
        history = appendShadowHistory(history, result.historyEntry);

        logExecution(result.ok ? "info" : "warn", {
            event: result.ok
                ? "execution.fsm_shadow.transition"
                : "execution.fsm_shadow.invalid_transition",
            workerId,
            taskId: task._id.toString(),
            transitionEvent: event.type,
            from: result.from.kind,
            to: result.to.kind,
            source: source ?? "task_cancellation",
            ...(result.ok ? {} : { error: result.error.message }),
        });
    }

    task.executionState = current as unknown as typeof task.executionState;
    task.stateHistory = history as unknown as typeof task.stateHistory;
    task.lifecycleState = deriveLegacyLifecycleState(current);

    return current;
}

export async function clearTaskLease(taskId: string, leaseOwner?: string | null): Promise<void> {
    if (leaseOwner) {
        await releaseTaskLease(taskId, leaseOwner);
        return;
    }

    await TaskModel.updateOne(
        { _id: taskId },
        { $set: { leaseOwner: null, leaseExpiresAt: null } },
    ).exec();
}

export interface FinalizeTaskCancellationInput {
    task: MutableTaskDocument;
    reason: string;
    initiatedBy: ExecutionActorType;
    requestedAt: string;
    workerId?: string;
    releaseLease?: boolean;
    source?: string;
}

/** Applies CANCEL_REQUESTED (if needed) + CANCEL_FINALIZED and persists terminal legacy state. */
export async function finalizeTaskCancellation(input: FinalizeTaskCancellationInput): Promise<MutableTaskDocument> {
    const { task, reason, initiatedBy, requestedAt, workerId, releaseLease = true, source } = input;
    const cancelledAt = new Date().toISOString();
    const events: ExecutionEvent[] = [];

    const current = resolveCurrentShadowState(task.executionState);
    if (!isExecutionState(task.executionState) || task.executionState.kind !== "cancelling") {
        events.push({
            type: "CANCEL_REQUESTED",
            initiatedBy,
            reason,
            requestedAt,
        });
    }
    events.push({
        type: "CANCEL_FINALIZED",
        reason,
        cancelledAt,
    });

    await applyShadowCancellationEvents(task, events, workerId, source);

    task.status = "failed";
    task.lifecycleState = "failed";
    task.result = buildCancelResult(reason);
    task.progress = 100;
    task.closedAt = task.closedAt ?? new Date();
    if (!task.cancelRequestedAt) {
        task.cancelRequestedAt = new Date(requestedAt);
    }
    task.cancelReason = reason;

    await task.save();

    if (releaseLease) {
        await clearTaskLease(task._id.toString(), task.leaseOwner);
        task.leaseOwner = null;
        task.leaseExpiresAt = null;
    }

    maybeLogTaskStateDivergence({
        taskId: task._id.toString(),
        lifecycleState: task.lifecycleState,
        executionState: task.executionState,
        workerId,
        source: source ?? "finalizeTaskCancellation",
    });

    return task;
}

export interface ProcessTaskCancellationInput {
    payload: TaskCancelRequestedPayload;
    workerId?: string;
}

/**
 * Handles `task.cancel.requested` outbox events.
 * In-flight leased tasks only get the cancel flag + shadow `CANCEL_REQUESTED`; the runner finalizes.
 */
export async function processTaskCancellation(input: ProcessTaskCancellationInput): Promise<"finalized" | "deferred" | "noop"> {
    const task = await TaskModel.findById(input.payload.taskId);
    if (!task) {
        throw new Error(`Task not found: ${input.payload.taskId}`);
    }

    if (isTaskTerminal(task)) {
        return "noop";
    }

    if (!task.cancelRequestedAt) {
        task.cancelRequestedAt = new Date(input.payload.requestedAt);
        task.cancelReason = input.payload.reason;
        task.cancelRequestedByType = input.payload.initiatedBy;
        await task.save();
    }

    if (isTaskActivelyLeased(task)) {
        if (isShadowCancellationEnabled()) {
            const current = resolveCurrentShadowState(task.executionState);
            if (!isExecutionState(task.executionState) || task.executionState.kind !== "cancelling") {
                await applyShadowCancellationEvents(
                    task,
                    [{
                        type: "CANCEL_REQUESTED",
                        initiatedBy: input.payload.initiatedBy,
                        reason: input.payload.reason,
                        requestedAt: input.payload.requestedAt,
                    }],
                    input.workerId,
                    "processTaskCancellation.deferred",
                );
                await task.save();
            }
        }
        return "deferred";
    }

    await finalizeTaskCancellation({
        task,
        reason: input.payload.reason,
        initiatedBy: input.payload.initiatedBy,
        requestedAt: input.payload.requestedAt,
        workerId: input.workerId,
        releaseLease: true,
        source: "processTaskCancellation",
    });

    return "finalized";
}

export function isTaskCancelRequestedPayload(payload: Record<string, unknown>): payload is TaskCancelRequestedPayload {
    return (
        typeof payload.taskId === "string"
        && typeof payload.conversationId === "string"
        && typeof payload.reason === "string"
        && typeof payload.requestedAt === "string"
        && (payload.initiatedBy === "user" || payload.initiatedBy === "agent" || payload.initiatedBy === "system")
    );
}
