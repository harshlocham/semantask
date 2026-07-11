import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { evaluateExecutionPolicy } from "../services/execution-policy.js";
import { getExecutionConfidenceThreshold } from "../services/execution-confidence.js";

afterEach(() => {
    delete process.env.TASK_EXECUTION_CONFIDENCE_THRESHOLDS;
});

test("actionType none with low confidence requires approval and cites intent", () => {
    const decision = evaluateExecutionPolicy({
        actionType: "none",
        confidence: 0.5,
        semanticType: "task",
    });

    assert.equal(decision.outcome, "approval_required");
    assert.equal(decision.threshold, 0.7);
    assert.equal(decision.confidence, 0.5);
    assert.equal(decision.semanticType, "task");
    assert.ok(decision.reasons.some((reason) => reason.includes('intent "task"')));
    assert.ok(decision.reasons.some((reason) => reason.includes("0.50 < 0.70")));
});

test("incident at 0.72 requires approval under default 0.75 threshold", () => {
    const decision = evaluateExecutionPolicy({
        actionType: "none",
        confidence: 0.72,
        semanticType: "incident",
    });

    assert.equal(decision.outcome, "approval_required");
    assert.equal(decision.threshold, 0.75);
});

test("task at 0.72 auto-executes under default 0.7 threshold", () => {
    const decision = evaluateExecutionPolicy({
        actionType: "none",
        confidence: 0.72,
        semanticType: "task",
    });

    assert.equal(decision.outcome, "auto_execute");
    assert.equal(decision.threshold, 0.7);
    assert.ok(decision.reasons.some((reason) => reason.includes("0.72 ≥ 0.70")));
});

test("env overlay raises task threshold", () => {
    process.env.TASK_EXECUTION_CONFIDENCE_THRESHOLDS = JSON.stringify({ task: 0.9 });
    assert.equal(getExecutionConfidenceThreshold("task"), 0.9);

    const decision = evaluateExecutionPolicy({
        actionType: "none",
        confidence: 0.8,
        semanticType: "task",
    });

    assert.equal(decision.outcome, "approval_required");
    assert.equal(decision.threshold, 0.9);
});

test("send_email without recipients is blocked", () => {
    const decision = evaluateExecutionPolicy({
        actionType: "send_email",
        confidence: 0.95,
        semanticType: "task",
        parameters: { to: [] },
    });

    assert.equal(decision.outcome, "blocked");
    assert.equal(decision.riskLevel, "high");
});
