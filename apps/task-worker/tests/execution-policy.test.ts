import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
    applyExecutionModeGate,
    evaluateExecutionPolicy,
} from "../services/execution-policy.js";
import { getExecutionConfidenceThreshold } from "../services/execution-confidence.js";

const ENV_KEYS = [
    "DEFAULT_EXECUTION_MODE",
    "GRANDFATHER_AUTO_TENANTS",
    "TASK_WORKER_ALLOWED_EMAIL_DOMAINS",
    "ALLOWED_EMAIL_DOMAINS",
] as const;

const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
    for (const key of ENV_KEYS) {
        originalEnv[key] = process.env[key];
    }
});

afterEach(() => {
    for (const key of ENV_KEYS) {
        const value = originalEnv[key];
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
});

test("actionType none with low confidence requires approval and cites intent", () => {
    const decision = evaluateExecutionPolicy({
        actionType: "none",
        confidence: 0.5,
        semanticType: "task",
        executionModeEnforce: false,
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
        executionModeEnforce: false,
    });

    assert.equal(decision.outcome, "approval_required");
    assert.equal(decision.threshold, 0.75);
});

test("task at 0.72 auto-executes under default 0.7 threshold", () => {
    const decision = evaluateExecutionPolicy({
        actionType: "none",
        confidence: 0.72,
        semanticType: "task",
        executionModeEnforce: false,
    });

    assert.equal(decision.outcome, "auto_execute");
    assert.equal(decision.threshold, 0.7);
    assert.ok(decision.reasons.some((reason) => reason.includes("0.72 ≥ 0.70")));
});

test("org confidenceThresholds.task overrides code default", () => {
    const decision = evaluateExecutionPolicy({
        actionType: "none",
        confidence: 0.8,
        semanticType: "task",
        organizationId: "507f1f77bcf86cd799439011",
        orgPolicy: {
            version: 2,
            executionMode: "auto_execute",
            confidenceThresholds: { task: 0.85 },
        },
        executionModeEnforce: true,
    });

    assert.equal(decision.outcome, "approval_required");
    assert.equal(decision.threshold, 0.85);
});

test("code default task threshold is 0.7", () => {
    assert.equal(getExecutionConfidenceThreshold("task"), 0.7);
});

test("inherited object keys fall back to the unknown numeric threshold", () => {
    assert.equal(getExecutionConfidenceThreshold("toString"), 0.7);
    assert.equal(getExecutionConfidenceThreshold("constructor"), 0.7);
    const decision = evaluateExecutionPolicy({
        actionType: "none",
        confidence: 0.95,
        semanticType: "toString" as never,
        executionModeEnforce: false,
    });
    assert.equal(decision.threshold, 0.7);
    assert.equal(typeof decision.threshold, "number");
});

test("send_email without recipients is blocked", () => {
    const decision = evaluateExecutionPolicy({
        actionType: "send_email",
        confidence: 0.95,
        semanticType: "task",
        parameters: { to: [] },
        executionModeEnforce: false,
    });

    assert.equal(decision.outcome, "blocked");
    assert.equal(decision.riskLevel, "high");
});

test("enforce + missing executionMode (suggest_only) blocks tools", () => {
    const decision = evaluateExecutionPolicy({
        actionType: "none",
        confidence: 0.95,
        semanticType: "task",
        executionModeEnforce: true,
    });

    assert.equal(decision.outcome, "blocked");
    assert.equal(decision.executionMode, "suggest_only");
    assert.equal(decision.executionModeEnforced, true);
    assert.ok(decision.reasons.includes("execution_mode:suggest_only"));
});

test("shadow mode keeps auto_execute for missing executionMode", () => {
    const decision = evaluateExecutionPolicy({
        actionType: "none",
        confidence: 0.95,
        semanticType: "task",
        executionModeEnforce: false,
    });

    assert.equal(decision.outcome, "auto_execute");
    assert.equal(decision.executionMode, "suggest_only");
    assert.equal(decision.executionModeEnforced, false);
});

test("enforce + require_approval caps auto_execute", () => {
    const decision = evaluateExecutionPolicy({
        actionType: "none",
        confidence: 0.95,
        semanticType: "task",
        organizationId: "507f1f77bcf86cd799439011",
        orgPolicy: {
            version: 1,
            executionMode: "require_approval",
        },
        executionModeEnforce: true,
    });

    assert.equal(decision.outcome, "approval_required");
    assert.equal(decision.executionMode, "require_approval");
    assert.ok(decision.reasons.some((reason) => reason.includes("execution_mode:require_approval")));
});

test("enforce + auto_execute org mode allows tools", () => {
    const decision = evaluateExecutionPolicy({
        actionType: "none",
        confidence: 0.95,
        semanticType: "task",
        organizationId: "507f1f77bcf86cd799439011",
        orgPolicy: {
            version: 1,
            executionMode: "auto_execute",
        },
        executionModeEnforce: true,
    });

    assert.equal(decision.outcome, "auto_execute");
    assert.equal(decision.executionMode, "auto_execute");
});

test("grandfather org resolves to auto_execute under enforce", () => {
    process.env.GRANDFATHER_AUTO_TENANTS = "507f1f77bcf86cd799439011";
    const decision = evaluateExecutionPolicy({
        actionType: "none",
        confidence: 0.95,
        semanticType: "task",
        organizationId: "507f1f77bcf86cd799439011",
        orgPolicy: {
            version: 0,
            executionMode: null,
        },
        executionModeEnforce: true,
    });

    assert.equal(decision.outcome, "auto_execute");
    assert.equal(decision.executionMode, "auto_execute");
});

test("explicit org executionMode beats grandfather list", () => {
    process.env.GRANDFATHER_AUTO_TENANTS = "507f1f77bcf86cd799439011";
    const decision = evaluateExecutionPolicy({
        actionType: "none",
        confidence: 0.95,
        semanticType: "task",
        organizationId: "507f1f77bcf86cd799439011",
        orgPolicy: {
            version: 1,
            executionMode: "suggest_only",
        },
        executionModeEnforce: true,
    });

    assert.equal(decision.outcome, "blocked");
    assert.equal(decision.executionMode, "suggest_only");
    assert.ok(decision.reasons.includes("execution_mode:suggest_only"));
});

test("org confidenceThresholds.task wins over code default", () => {
    const decision = evaluateExecutionPolicy({
        actionType: "none",
        confidence: 0.8,
        semanticType: "task",
        organizationId: "507f1f77bcf86cd799439011",
        orgPolicy: {
            version: 2,
            executionMode: "auto_execute",
            confidenceThresholds: { task: 0.75 },
        },
        executionModeEnforce: true,
    });

    assert.equal(decision.outcome, "auto_execute");
    assert.equal(decision.threshold, 0.75);
    assert.ok(decision.reasons.some((reason) => reason.includes("0.80 ≥ 0.75")));
});

test("org allowedEmailDomains beats env email allowlist", () => {
    process.env.TASK_WORKER_ALLOWED_EMAIL_DOMAINS = "env-only.com";
    const allowed = evaluateExecutionPolicy({
        actionType: "send_email",
        confidence: 0.95,
        semanticType: "task",
        parameters: { to: ["user@org-only.com"] },
        organizationId: "507f1f77bcf86cd799439011",
        orgPolicy: {
            version: 3,
            executionMode: "auto_execute",
            allowedEmailDomains: ["org-only.com"],
            promptGuardMode: "off",
        },
        executionModeEnforce: true,
    });
    assert.equal(allowed.outcome, "auto_execute");

    const denied = evaluateExecutionPolicy({
        actionType: "send_email",
        confidence: 0.95,
        semanticType: "task",
        parameters: { to: ["user@env-only.com"] },
        organizationId: "507f1f77bcf86cd799439011",
        orgPolicy: {
            version: 3,
            executionMode: "auto_execute",
            allowedEmailDomains: ["org-only.com"],
            promptGuardMode: "off",
        },
        executionModeEnforce: true,
    });
    assert.equal(denied.outcome, "approval_required");
    assert.ok(denied.reasons.some((reason) => reason.includes("org policy v3")));
});

test("org auto_execute plus tool suggest_only blocks that tool", () => {
    const blocked = evaluateExecutionPolicy({
        actionType: "send_email",
        confidence: 0.95,
        semanticType: "task",
        parameters: { to: ["user@example.com"] },
        organizationId: "507f1f77bcf86cd799439011",
        orgPolicy: {
            version: 4,
            executionMode: "auto_execute",
            promptGuardMode: "off",
            toolExecutionModes: { send_email: "suggest_only" },
        },
        executionModeEnforce: true,
    });
    assert.equal(blocked.outcome, "blocked");
    assert.ok(blocked.reasons.includes("tool_execution_mode:suggest_only"));

    const otherTool = evaluateExecutionPolicy({
        actionType: "create_github_issue",
        confidence: 0.95,
        semanticType: "task",
        parameters: { title: "Classifier retest" },
        organizationId: "507f1f77bcf86cd799439011",
        orgPolicy: {
            version: 4,
            executionMode: "auto_execute",
            promptGuardMode: "off",
            toolExecutionModes: { send_email: "suggest_only" },
        },
        executionModeEnforce: true,
    });
    assert.equal(otherTool.outcome, "auto_execute");
});

test("tool require_approval does not auto-run", () => {
    const decision = evaluateExecutionPolicy({
        actionType: "send_email",
        confidence: 0.95,
        semanticType: "task",
        parameters: { to: ["user@example.com"] },
        organizationId: "507f1f77bcf86cd799439011",
        orgPolicy: {
            version: 4,
            executionMode: "auto_execute",
            promptGuardMode: "off",
            toolExecutionModes: { send_email: "require_approval" },
        },
        executionModeEnforce: true,
    });
    assert.equal(decision.outcome, "approval_required");
    assert.ok(decision.reasons.includes("tool_execution_mode:require_approval"));
});

test("org suggest_only still blocks a tool set to auto_execute", () => {
    const decision = evaluateExecutionPolicy({
        actionType: "send_email",
        confidence: 0.95,
        semanticType: "task",
        parameters: { to: ["user@example.com"] },
        organizationId: "507f1f77bcf86cd799439011",
        orgPolicy: {
            version: 4,
            executionMode: "suggest_only",
            promptGuardMode: "off",
            toolExecutionModes: { send_email: "auto_execute" },
        },
        executionModeEnforce: true,
    });
    assert.equal(decision.outcome, "blocked");
    assert.ok(decision.reasons.includes("execution_mode:suggest_only"));
    assert.equal(decision.reasons.some((reason) => reason.startsWith("tool_execution_mode:")), false);
});

test("applyExecutionModeGate is pure for suggest_only enforce", () => {
    const gated = applyExecutionModeGate(
        {
            outcome: "auto_execute",
            riskLevel: "low",
            reasons: ["ok"],
            confidence: 0.9,
            threshold: 0.7,
        },
        "suggest_only",
        true
    );
    assert.equal(gated.outcome, "blocked");
    assert.deepEqual(gated.reasons, ["execution_mode:suggest_only"]);
});
