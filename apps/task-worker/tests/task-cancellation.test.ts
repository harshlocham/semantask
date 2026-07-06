import "./test-env.js";
import assert from "node:assert/strict";
import test from "node:test";
import { reduceExecutionState } from "../services/execution-state-machine.js";
import { deriveLegacyLifecycleState } from "@semantask/types";
import {
    isTaskActivelyLeased,
    isTaskCancellationRequested,
    isTaskTerminal,
} from "../services/task-cancellation.js";

test("isTaskTerminal detects completed and failed lifecycle", () => {
    assert.equal(isTaskTerminal({ lifecycleState: "completed", status: "completed" }), true);
    assert.equal(isTaskTerminal({ lifecycleState: "failed", status: "failed" }), true);
    assert.equal(isTaskTerminal({ lifecycleState: "executing", status: "executing" }), false);
});

test("isTaskCancellationRequested requires cancelRequestedAt", () => {
    assert.equal(isTaskCancellationRequested({ cancelRequestedAt: new Date() }), true);
    assert.equal(isTaskCancellationRequested({ cancelRequestedAt: null }), false);
});

test("isTaskActivelyLeased requires owner and unexpired lease", () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    assert.equal(
        isTaskActivelyLeased(
            { leaseOwner: "worker-1", leaseExpiresAt: new Date("2026-07-06T12:00:30.000Z") },
            now,
        ),
        true,
    );
    assert.equal(
        isTaskActivelyLeased(
            { leaseOwner: "worker-1", leaseExpiresAt: new Date("2026-07-06T11:59:00.000Z") },
            now,
        ),
        false,
    );
});

test("CANCEL_REQUESTED then CANCEL_FINALIZED projects legacy failed", () => {
    const lease = {
        runId: "run-1",
        workerId: "worker-1",
        leaseExpiresAt: "2026-07-06T12:00:30.000Z",
    };
    const cancelling = reduceExecutionState(
        { kind: "tool_executing", iteration: 1, stepId: "step-1", toolName: "send_email", attempt: 1, idempotencyKey: "idem-1", ...lease },
        {
            type: "CANCEL_REQUESTED",
            initiatedBy: "user",
            reason: "User cancelled.",
            requestedAt: "2026-07-06T12:00:10.000Z",
        },
    );
    assert.equal(cancelling.kind, "cancelling");
    assert.equal(deriveLegacyLifecycleState(cancelling), "executing");

    const cancelled = reduceExecutionState(cancelling, {
        type: "CANCEL_FINALIZED",
        reason: "User cancelled.",
        cancelledAt: "2026-07-06T12:00:11.000Z",
    });
    assert.equal(cancelled.kind, "cancelled");
    assert.equal(deriveLegacyLifecycleState(cancelled), "failed");
});
