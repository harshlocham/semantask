import TaskModel from "@semantask/db/models/Task";
import type { ExecutionState, TaskLifecycleState } from "@semantask/types";
import { deriveLegacyLifecycleState } from "@semantask/types";
import {
    appendShadowHistory,
    reduceShadowExecutionEvent,
    resolveCurrentShadowState,
    type ShadowExecutionStateHistoryEntry,
} from "./execution-state-shadow.js";
import { logExecution } from "./execution-logger.js";
import { maybeLogTaskStateDivergence } from "./state-divergence-check.js";

/**
 * The retry scanner promotes legacy `lifecycleState` to `ready` but historically
 * left the shadow FSM at `retry_scheduled`. When `TASK_RETRY_SHADOW_EMIT=1`
 * (and shadow mode is on), emit `RETRY_DUE` so the FSM moves to `queued`
 * (projects to `ready`, matching the scanner's legacy write).
 */
export function isRetryShadowEmitEnabled(): boolean {
    return (
        process.env.TASK_RETRY_SHADOW_EMIT === "1"
        && process.env.TASK_EXECUTION_FSM_SHADOW_MODE !== "0"
    );
}

export interface EmitRetryDueShadowStateInput {
    taskId: string;
    queuedAt: string;
    workerId?: string;
    source?: string;
}

/** Applies `RETRY_DUE` to the task shadow FSM. No-op unless `TASK_RETRY_SHADOW_EMIT=1`. */
export async function emitRetryDueShadowState(input: EmitRetryDueShadowStateInput): Promise<boolean> {
    if (!isRetryShadowEmitEnabled()) {
        return false;
    }

    const task = await TaskModel.findById(input.taskId);
    if (!task) {
        return false;
    }

    const current: ExecutionState = resolveCurrentShadowState(task.executionState);
    const result = reduceShadowExecutionEvent({
        current,
        event: { type: "RETRY_DUE", queuedAt: input.queuedAt },
        workerId: input.workerId ?? null,
    });

    const history: ShadowExecutionStateHistoryEntry[] = appendShadowHistory(
        (Array.isArray(task.stateHistory) ? task.stateHistory : []) as unknown as ShadowExecutionStateHistoryEntry[],
        result.historyEntry,
    );

    logExecution(result.ok ? "info" : "warn", {
        event: result.ok
            ? "execution.fsm_shadow.transition"
            : "execution.fsm_shadow.invalid_transition",
        workerId: input.workerId,
        taskId: input.taskId,
        transitionEvent: "RETRY_DUE",
        from: result.from.kind,
        to: result.to.kind,
        source: input.source ?? "retry_shadow",
        ...(result.ok ? {} : { error: result.error.message }),
    });

    if (!result.ok) {
        return false;
    }

    const projectedLifecycle: TaskLifecycleState = deriveLegacyLifecycleState(result.to);

    task.executionState = result.to as unknown as typeof task.executionState;
    task.stateHistory = history as unknown as typeof task.stateHistory;
    task.lifecycleState = projectedLifecycle;

    try {
        await task.save();
    } catch (error) {
        logExecution("warn", {
            event: "execution.fsm_shadow.persist_failed",
            workerId: input.workerId,
            taskId: input.taskId,
            source: input.source ?? "retry_shadow",
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }

    maybeLogTaskStateDivergence({
        taskId: input.taskId,
        lifecycleState: task.lifecycleState,
        executionState: task.executionState,
        workerId: input.workerId,
        source: input.source ?? "retry_shadow",
    });

    return true;
}
