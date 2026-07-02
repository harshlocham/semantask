import TaskModel from "@chat/db/models/Task";
import type { ExecutionEvent, ExecutionState, TaskLifecycleState } from "@chat/types";
import { deriveLegacyLifecycleState } from "@chat/types";
import {
    appendShadowHistory,
    createQueuedShadowState,
    reduceShadowExecutionEvent,
    resolveCurrentShadowState,
    type ShadowExecutionStateHistoryEntry,
} from "./execution-state-shadow.js";
import { logExecution } from "./execution-logger.js";
import { maybeLogTaskStateDivergence } from "./state-divergence-check.js";

/**
 * Policy early-return paths in `processTaskExecutionRequested` (blocked / approval)
 * historically updated only the legacy fields, leaving the shadow FSM stale.
 * When `TASK_POLICY_SHADOW_EMIT=1` (and shadow mode is on), these paths emit the
 * matching `POLICY_BLOCKED` / `POLICY_APPROVAL_REQUIRED` events and keep the legacy
 * `lifecycleState` aligned with the FSM projection so dual-state stays consistent.
 */
export function isPolicyShadowEmitEnabled(): boolean {
    return (
        process.env.TASK_POLICY_SHADOW_EMIT === "1"
        && process.env.TASK_EXECUTION_FSM_SHADOW_MODE !== "0"
    );
}

function baselineForPolicyEvaluation(executionState: unknown): ExecutionState {
    const current = resolveCurrentShadowState(executionState);
    // Policy evaluation always begins a fresh request; POLICY_EVALUATE is only legal
    // from `queued`, so normalize any non-queued prior state to a fresh queued baseline.
    return current.kind === "queued" ? current : createQueuedShadowState();
}

export interface EmitPolicyShadowStateInput {
    taskId: string;
    events: ExecutionEvent[];
    workerId?: string;
    source?: string;
}

/**
 * Applies the given execution events to the task's shadow FSM and persists the
 * resulting `executionState` + `stateHistory` together with an aligned legacy
 * `lifecycleState`. No-op unless `TASK_POLICY_SHADOW_EMIT=1`.
 */
export async function emitPolicyShadowState(input: EmitPolicyShadowStateInput): Promise<boolean> {
    if (!isPolicyShadowEmitEnabled() || input.events.length === 0) {
        return false;
    }

    const task = await TaskModel.findById(input.taskId);
    if (!task) {
        return false;
    }

    let current = baselineForPolicyEvaluation(task.executionState);
    let history: ShadowExecutionStateHistoryEntry[] = (
        Array.isArray(task.stateHistory) ? task.stateHistory : []
    ) as unknown as ShadowExecutionStateHistoryEntry[];

    for (const event of input.events) {
        const result = reduceShadowExecutionEvent({
            current,
            event,
            workerId: input.workerId ?? null,
        });

        current = result.to;
        history = appendShadowHistory(history, result.historyEntry);

        logExecution(result.ok ? "info" : "warn", {
            event: result.ok
                ? "execution.fsm_shadow.transition"
                : "execution.fsm_shadow.invalid_transition",
            workerId: input.workerId,
            taskId: input.taskId,
            transitionEvent: event.type,
            from: result.from.kind,
            to: result.to.kind,
            source: input.source ?? "policy_shadow",
            ...(result.ok ? {} : { error: result.error.message }),
        });
    }

    const projectedLifecycle: TaskLifecycleState = deriveLegacyLifecycleState(current);

    task.executionState = current as unknown as typeof task.executionState;
    task.stateHistory = history as unknown as typeof task.stateHistory;
    task.lifecycleState = projectedLifecycle;

    try {
        await task.save();
    } catch (error) {
        logExecution("warn", {
            event: "execution.fsm_shadow.persist_failed",
            workerId: input.workerId,
            taskId: input.taskId,
            source: input.source ?? "policy_shadow",
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }

    maybeLogTaskStateDivergence({
        taskId: input.taskId,
        lifecycleState: task.lifecycleState,
        executionState: task.executionState,
        workerId: input.workerId,
        source: input.source ?? "policy_shadow",
    });

    return true;
}
