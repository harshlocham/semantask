import "./test-env.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionEvent, ExecutionState } from "@semantask/types";
import {
    appendShadowHistory,
    createQueuedShadowState,
    reduceShadowExecutionEvent,
    resolveCurrentShadowState,
    type ShadowExecutionStateHistoryEntry,
} from "../services/execution-state-shadow.js";
import { deriveLegacyLifecycleState } from "@semantask/types";

/**
 * These tests exercise the pure shadow-transition sequences used by
 * `emitPolicyShadowState`. The DB-bound `emitPolicyShadowState` wrapper is a thin
 * persistence layer over these reductions.
 */
function applyPolicyEvents(
    executionState: unknown,
    events: ExecutionEvent[],
): { state: ExecutionState; history: ShadowExecutionStateHistoryEntry[]; allLegal: boolean } {
    const resolved = resolveCurrentShadowState(executionState);
    let current: ExecutionState = resolved.kind === "queued" ? resolved : createQueuedShadowState();
    let history: ShadowExecutionStateHistoryEntry[] = [];
    let allLegal = true;

    for (const event of events) {
        const result = reduceShadowExecutionEvent({ current, event, workerId: "worker-1" });
        current = result.to;
        history = appendShadowHistory(history, result.historyEntry);
        if (!result.ok) allLegal = false;
    }

    return { state: current, history, allLegal };
}

test("blocked policy path drives shadow FSM to policy_blocked", () => {
    const events: ExecutionEvent[] = [
        { type: "POLICY_EVALUATE" },
        { type: "POLICY_BLOCKED", reason: "outside allowed domains", decidedAt: "2026-07-02T00:00:00.000Z" },
    ];

    const { state, history, allLegal } = applyPolicyEvents(null, events);

    assert.equal(allLegal, true);
    assert.equal(state.kind, "policy_blocked");
    assert.equal(history.length, 2);
    assert.equal(deriveLegacyLifecycleState(state), "failed");
});

test("approval policy path drives shadow FSM to awaiting_approval", () => {
    const events: ExecutionEvent[] = [
        { type: "POLICY_EVALUATE" },
        { type: "POLICY_APPROVAL_REQUIRED", actionType: "send_email", requestedAt: "2026-07-02T00:00:00.000Z" },
    ];

    const { state, allLegal } = applyPolicyEvents(null, events);

    assert.equal(allLegal, true);
    assert.equal(state.kind, "awaiting_approval");
    assert.equal(deriveLegacyLifecycleState(state), "waiting_for_approval");
});

test("aligned lifecycle projection matches shadow kind on both policy paths", () => {
    const blocked = applyPolicyEvents(null, [
        { type: "POLICY_EVALUATE" },
        { type: "POLICY_BLOCKED", reason: "no valid recipients", decidedAt: "2026-07-02T00:00:00.000Z" },
    ]);
    const approval = applyPolicyEvents(null, [
        { type: "POLICY_EVALUATE" },
        { type: "POLICY_APPROVAL_REQUIRED", actionType: "create_github_issue", requestedAt: "2026-07-02T00:00:00.000Z" },
    ]);

    // deriveLegacyLifecycleState(final) is what emitPolicyShadowState writes to lifecycleState,
    // so the legacy field and FSM projection agree (divergence check passes).
    assert.equal(deriveLegacyLifecycleState(blocked.state), "failed");
    assert.equal(deriveLegacyLifecycleState(approval.state), "waiting_for_approval");
});

test("policy evaluation normalizes a stale non-queued baseline to queued", () => {
    const stale: ExecutionState = {
        kind: "succeeded",
        finishedAt: "2026-07-01T00:00:00.000Z",
        runId: "run-old",
        result: { confidence: 1, summary: "old", evidence: null },
    };

    const { state, allLegal } = applyPolicyEvents(stale, [
        { type: "POLICY_EVALUATE" },
        { type: "POLICY_BLOCKED", reason: "unsafe", decidedAt: "2026-07-02T00:00:00.000Z" },
    ]);

    assert.equal(allLegal, true);
    assert.equal(state.kind, "policy_blocked");
});

test("APPROVAL_GRANTED resumes an awaiting_approval shadow into planning", () => {
    const awaiting: ExecutionState = {
        kind: "awaiting_approval",
        actionType: "send_email",
        requestedAt: "2026-07-02T00:00:00.000Z",
    };

    const result = reduceShadowExecutionEvent({
        current: awaiting,
        event: {
            type: "APPROVAL_GRANTED",
            runId: "run-1",
            workerId: "worker-1",
            leaseExpiresAt: "2026-07-02T00:05:00.000Z",
        },
        workerId: "worker-1",
    });

    assert.equal(result.ok, true);
    assert.equal(result.to.kind, "planning");
});
