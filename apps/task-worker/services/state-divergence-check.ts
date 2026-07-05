import type { ExecutionState, TaskLifecycleState } from "@semantask/types";
import { deriveLegacyLifecycleState, taskLifecycleMatchesExecutionProjection } from "@semantask/types";
import { isExecutionState } from "./execution-state-shadow.js";
import { logExecution } from "./execution-logger.js";

export function isTaskStateDivergenceCheckEnabled(): boolean {
    return process.env.TASK_STATE_DIVERGENCE_CHECK === "1";
}

export type TaskStateDivergence = {
    lifecycleState: TaskLifecycleState;
    executionStateKind: ExecutionState["kind"];
    projectedLifecycleState: TaskLifecycleState;
};

export function detectTaskStateDivergence(
    lifecycleState: string | null | undefined,
    executionState: unknown,
): TaskStateDivergence | null {
    if (!lifecycleState || !isExecutionState(executionState)) {
        return null;
    }

    const lifecycle = lifecycleState as TaskLifecycleState;
    if (taskLifecycleMatchesExecutionProjection(lifecycle, executionState)) {
        return null;
    }

    return {
        lifecycleState: lifecycle,
        executionStateKind: executionState.kind,
        projectedLifecycleState: deriveLegacyLifecycleState(executionState),
    };
}

export interface MaybeLogTaskStateDivergenceInput {
    taskId: string;
    lifecycleState?: string | null;
    executionState?: unknown;
    workerId?: string;
    runId?: string;
    source?: string;
}

/** When `TASK_STATE_DIVERGENCE_CHECK=1`, logs `state_diverged` if legacy and FSM projection disagree. */
export function maybeLogTaskStateDivergence(input: MaybeLogTaskStateDivergenceInput): boolean {
    if (!isTaskStateDivergenceCheckEnabled()) {
        return false;
    }

    const divergence = detectTaskStateDivergence(input.lifecycleState, input.executionState);
    if (!divergence) {
        return false;
    }

    logExecution("warn", {
        event: "state_diverged",
        taskId: input.taskId,
        lifecycleState: divergence.lifecycleState,
        executionStateKind: divergence.executionStateKind,
        projectedLifecycleState: divergence.projectedLifecycleState,
        workerId: input.workerId,
        runId: input.runId,
        source: input.source,
    });

    return true;
}
