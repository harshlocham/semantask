import type { ExecutionEvent } from "@semantask/types";
import { logExecution } from "../execution-logger.js";
import { applyLifecycleProjection } from "../state-projection.js";
import {
    appendShadowHistory,
    createQueuedShadowState,
    isExecutionState,
    reduceShadowExecutionEvent,
    resolveCurrentShadowState,
    shouldResetShadowRunState,
} from "../execution-state-shadow.js";
import type { AgentContext } from "./context.js";
import type { TaskDocumentLike } from "./types.js";

/**
 * Owns the shadow execution-state FSM writes for a run. Reduces execution
 * events against the current shadow state, persists them, and projects the
 * legacy lifecycle field.
 */
export class ShadowFsmWriter {
    constructor(private readonly ctx: AgentContext) {}

    isShadowExecutionStateEnabled(): boolean {
        return process.env.TASK_EXECUTION_FSM_SHADOW_MODE !== "0";
    }

    getShadowLeaseExpiresAt(task: TaskDocumentLike): string {
        if (task.leaseExpiresAt instanceof Date) {
            return task.leaseExpiresAt.toISOString();
        }

        const leaseMs = Math.max(1000, Number(process.env.TASK_LEASE_MS || 30000));
        return new Date(Date.now() + leaseMs).toISOString();
    }

    async persistShadowExecutionState(task: TaskDocumentLike, event: ExecutionEvent) {
        if (!this.isShadowExecutionStateEnabled()) {
            return;
        }

        const current = resolveCurrentShadowState(task.executionState);
        const result = reduceShadowExecutionEvent({
            current,
            event,
            workerId: this.ctx.workerId,
        });

        task.executionState = result.to;
        task.stateHistory = appendShadowHistory(task.stateHistory, result.historyEntry);
        applyLifecycleProjection(task, "persistShadowExecutionState", {
            workerId: this.ctx.workerId ?? undefined,
            runId: this.ctx.currentRunId ?? undefined,
        });

        try {
            await task.save();
        } catch (error) {
            logExecution("warn", {
                event: "execution.fsm_shadow.persist_failed",
                runId: this.ctx.currentRunId ?? undefined,
                workerId: this.ctx.workerId,
                taskId: task._id.toString(),
                transitionEvent: event.type,
                error: error instanceof Error ? error.message : String(error),
            });
            return;
        }

        logExecution(result.ok ? "info" : "warn", {
            event: result.ok ? "execution.fsm_shadow.transition" : "execution.fsm_shadow.invalid_transition",
            runId: this.ctx.currentRunId ?? undefined,
            workerId: this.ctx.workerId,
            taskId: task._id.toString(),
            transitionEvent: event.type,
            from: result.from.kind,
            to: result.to.kind,
            ...(result.ok ? {} : { error: result.error.message }),
        });

        this.ctx.maybeCheckStateDivergence(task, "persistShadowExecutionState");
    }

    async startShadowExecutionRun(task: TaskDocumentLike, runId: string) {
        if (!this.isShadowExecutionStateEnabled()) {
            return;
        }

        if (shouldResetShadowRunState(task.executionState)) {
            task.executionState = createQueuedShadowState();
            task.stateHistory = task.stateHistory ?? [];
        }

        if (isExecutionState(task.executionState) && task.executionState.kind === "paused") {
            await this.persistShadowExecutionState(task, {
                type: "CLARIFICATION_RESOLVED",
                runId,
                workerId: this.ctx.workerId,
                leaseExpiresAt: this.getShadowLeaseExpiresAt(task),
                iteration: Math.max(1, (task.iterationCount ?? 0) + 1),
            });
            return;
        }

        // A prior request may have parked the shadow FSM in `awaiting_approval`
        // (see policy-shadow.ts). The approved re-run resumes via APPROVAL_GRANTED.
        if (isExecutionState(task.executionState) && task.executionState.kind === "awaiting_approval") {
            await this.persistShadowExecutionState(task, {
                type: "APPROVAL_GRANTED",
                runId,
                workerId: this.ctx.workerId,
                leaseExpiresAt: this.getShadowLeaseExpiresAt(task),
            });
            return;
        }

        if (isExecutionState(task.executionState) && task.executionState.kind === "queued") {
            await this.persistShadowExecutionState(task, { type: "POLICY_EVALUATE" });
        }

        if (isExecutionState(task.executionState) && task.executionState.kind === "policy_evaluating") {
            await this.persistShadowExecutionState(task, {
                type: "LEASE_ACQUIRED",
                runId,
                workerId: this.ctx.workerId,
                leaseExpiresAt: this.getShadowLeaseExpiresAt(task),
            });
        }
    }
}
