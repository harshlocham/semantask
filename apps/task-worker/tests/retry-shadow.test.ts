import "./test-env.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionEvent, ExecutionState } from "@chat/types";
import {
    appendShadowHistory,
    reduceShadowExecutionEvent,
    resolveCurrentShadowState,
    type ShadowExecutionStateHistoryEntry,
} from "../services/execution-state-shadow.js";
import { deriveLegacyLifecycleState } from "@chat/types";
import { isMongoTransactionUnsupported } from "@chat/services/mongo-transaction";

test("isMongoTransactionUnsupported detects standalone Mongo errors", () => {
    assert.equal(
        isMongoTransactionUnsupported(new Error("Transaction numbers are only allowed on a replica set member or mongos")),
        true,
    );
    assert.equal(isMongoTransactionUnsupported(new Error("not a replica set")), true);
    assert.equal(isMongoTransactionUnsupported(new Error("standalone mongod")), true);
    assert.equal(isMongoTransactionUnsupported(new Error("connection refused")), false);
});

function applyRetryDue(
    executionState: unknown,
    queuedAt: string,
): { state: ExecutionState; ok: boolean } {
    const current = resolveCurrentShadowState(executionState);
    const result = reduceShadowExecutionEvent({
        current,
        event: { type: "RETRY_DUE", queuedAt },
        workerId: "worker-1",
    });
    return { state: result.to, ok: result.ok };
}

test("RETRY_DUE transitions retry_scheduled shadow FSM to queued", () => {
    const retryScheduled: ExecutionState = {
        kind: "retry_scheduled",
        retryCount: 2,
        maxRetries: 5,
        nextRetryAt: "2026-07-02T00:00:00.000Z",
        lastError: "timeout",
        category: "tool_timeout",
    };

    const { state, ok } = applyRetryDue(retryScheduled, "2026-07-02T00:05:00.000Z");

    assert.equal(ok, true);
    assert.equal(state.kind, "queued");
    assert.equal(deriveLegacyLifecycleState(state), "ready");
});

test("RETRY_DUE projection matches retry scanner legacy promote to ready", () => {
    const retryScheduled: ExecutionState = {
        kind: "retry_scheduled",
        retryCount: 1,
        maxRetries: 3,
        nextRetryAt: "2026-07-02T00:00:00.000Z",
        lastError: "tool failed",
        category: "tool_failure",
    };

    const { state } = applyRetryDue(retryScheduled, "2026-07-02T00:01:00.000Z");
    assert.equal(deriveLegacyLifecycleState(state), "ready");
});

test("RETRY_DUE is invalid when shadow FSM is not retry_scheduled", () => {
    const queued = resolveCurrentShadowState(null);
    const { ok } = applyRetryDue(queued, "2026-07-02T00:01:00.000Z");
    assert.equal(ok, false);
});

test("retry shadow history records RETRY_DUE transition", () => {
    const retryScheduled: ExecutionState = {
        kind: "retry_scheduled",
        retryCount: 0,
        maxRetries: 3,
        nextRetryAt: "2026-07-02T00:00:00.000Z",
        lastError: "err",
        category: "unknown",
    };
    const event: ExecutionEvent = { type: "RETRY_DUE", queuedAt: "2026-07-02T00:02:00.000Z" };
    const result = reduceShadowExecutionEvent({ current: retryScheduled, event, workerId: "w1" });
    const history = appendShadowHistory([], result.historyEntry);

    assert.equal(history.length, 1);
    assert.equal((history[0] as ShadowExecutionStateHistoryEntry).event.type, "RETRY_DUE");
    assert.equal(result.to.kind, "queued");
});
