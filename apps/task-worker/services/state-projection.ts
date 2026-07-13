import type { ExecutionState, TaskLifecycleState, TaskStatus } from "@semantask/types";
import {
    deriveLegacyLifecycleState,
    deriveLegacyTaskStatus,
} from "@semantask/types";
import { isExecutionState } from "./execution-state-shadow.js";
import { logExecution } from "./execution-logger.js";

export type TaskStateProjectionMode = "off" | "shadow" | "enforce";

export type ProjectableTask = {
    _id: { toString(): string };
    lifecycleState?: string | null;
    status?: string;
    executionState?: unknown;
};

export function getTaskStateProjectionMode(): TaskStateProjectionMode {
    const raw = (process.env.TASK_STATE_PROJECTION_MODE || "off").trim().toLowerCase();
    if (raw === "shadow" || raw === "enforce") {
        return raw;
    }
    return "off";
}

export type ApplyLifecycleProjectionOptions = {
    /**
     * When mode is `off`, treat as this mode instead.
     * Used by policy-shadow to preserve pre-5.2 alignment (always project on FSM write).
     */
    treatOffAs?: "noop" | "enforce";
    workerId?: string;
    runId?: string;
};

/**
 * Apply (or observe) legacy lifecycle/status projection from `task.executionState`.
 * Call after assigning `executionState`, before `save`.
 */
export function applyLifecycleProjection(
    task: ProjectableTask,
    source: string,
    options?: ApplyLifecycleProjectionOptions
): void {
    let mode = getTaskStateProjectionMode();
    if (mode === "off") {
        if (options?.treatOffAs === "enforce") {
            mode = "enforce";
        } else {
            return;
        }
    }

    if (!isExecutionState(task.executionState)) {
        return;
    }

    const executionState = task.executionState as ExecutionState;
    const projectedLifecycle = deriveLegacyLifecycleState(executionState);
    const projectedStatus = deriveLegacyTaskStatus(executionState);
    const currentLifecycle = typeof task.lifecycleState === "string" ? task.lifecycleState : null;
    const currentStatus = typeof task.status === "string" ? task.status : null;

    if (mode === "shadow") {
        if ((currentLifecycle && currentLifecycle !== projectedLifecycle) || (currentStatus && currentStatus !== projectedStatus)) {
            logExecution("warn", {
                event: "state_projection_shadow",
                taskId: task._id.toString(),
                source,
                workerId: options?.workerId,
                runId: options?.runId,
                lifecycleState: currentLifecycle,
                projectedLifecycleState: projectedLifecycle,
                executionStateKind: executionState.kind,
                status: currentStatus,
                projectedStatus,
            });
        }
        return;
    }

    // enforce
    task.lifecycleState = projectedLifecycle as TaskLifecycleState;
    task.status = projectedStatus as TaskStatus;
}
