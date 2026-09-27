import { describe, expect, it } from "@jest/globals";
import type { TaskExecutionEventRecord, TaskExecutionUpdatedPayload } from "@semantask/types";
import { deriveExecutionView } from "@/hooks/useTaskExecution";

function event(
    overrides: Partial<TaskExecutionEventRecord> & Pick<TaskExecutionEventRecord, "type" | "sequence">
): TaskExecutionEventRecord {
    return {
        _id: `evt-${overrides.sequence}`,
        taskId: "task-1",
        conversationId: "conv-1",
        runId: "forn-6a67c4277d19:50876f90-1798431257249-27951",
        phase: "intake",
        payload: { summary: "" },
        createdAt: "2026-09-26T13:00:00.000Z",
        ...overrides,
    };
}

function latest(
    overrides: Partial<TaskExecutionUpdatedPayload> = {}
): TaskExecutionUpdatedPayload {
    return {
        taskId: "task-1",
        conversationId: "conv-1",
        state: "approval_pending",
        actionType: "send_email",
        summary: null,
        error: null,
        updatedAt: "2026-09-26T13:00:00.000Z",
        runId: "forn-6a67c4277d19:50876f90-1798431257249-27951",
        ...overrides,
    };
}

describe("deriveExecutionView", () => {
    it("labels blank summaries from the event type instead of empty cards", () => {
        const view = deriveExecutionView([
            event({ type: "execution_started", sequence: 1, payload: { summary: "" } }),
            event({ type: "phase_transition", sequence: 2, payload: { summary: "   " } }),
        ]);

        expect(view.steps.map((step) => step.label)).toEqual([
            "Execution started",
            "Phase transition",
        ]);
        expect(view.steps.every((step) => step.label.trim().length > 0)).toBe(true);
    });

    it("does not keep approval pending or a running last step after execution fails", () => {
        const view = deriveExecutionView(
            [
                event({ type: "waiting_for_approval", sequence: 1 }),
                event({ type: "execution_started", sequence: 2 }),
                event({ type: "execution_failed", sequence: 3, payload: { error: "Policy blocked tools." } }),
            ],
            latest({ state: "approval_pending", progress: 25 })
        );

        expect(view.approvalPending).toBe(false);
        expect(view.retryStatus).toBeNull();
        expect(view.failureReason).toBe("Policy blocked tools.");
        expect(view.steps.some((step) => step.status === "running")).toBe(false);
    });

    it("treats latest failed state as terminal even without a failed event", () => {
        const view = deriveExecutionView(
            [event({ type: "execution_started", sequence: 1 })],
            latest({ state: "failed", error: "Worker denied suggest_only." })
        );

        expect(view.approvalPending).toBe(false);
        expect(view.failureReason).toBe("Worker denied suggest_only.");
        expect(view.steps.at(-1)?.status).not.toBe("running");
    });

    it("keeps Allow AI tools when the latest state is still approval_pending", () => {
        const view = deriveExecutionView(
            [event({ type: "waiting_for_approval", sequence: 1 })],
            latest({
                state: "approval_pending",
                error: "Recipient or parameters are incomplete.",
            })
        );

        expect(view.approvalPending).toBe(true);
        expect(view.failureReason).toBe("Recipient or parameters are incomplete.");
    });
});
