import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import {
    assertAcceptCreatesCoordinationOnly,
    getClassifierMode,
    getEffectiveExecutionMode,
    isAcceptCreatesExecutionEnabled,
    isCoordinationBoardEnabled,
    isOrgDashboardEnabled,
    isExecutionModeEnforce,
    isSuggestionIngressEnabled,
    isWorkInboxUiEnabled,
    parseDefaultExecutionMode,
    shouldBlockExecutionEnqueue,
} from "../config";

const ENV_KEYS = [
    "DEFAULT_EXECUTION_MODE",
    "GRANDFATHER_AUTO_TENANTS",
    "TASK_CLASSIFIER_MODE",
    "COORDINATION_BOARD",
    "ORG_DASHBOARD",
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

describe("getEffectiveExecutionMode", () => {
    const orgId = "507f1f77bcf86cd799439011";

    it("defaults missing field to suggest_only", () => {
        expect(getEffectiveExecutionMode({ organizationId: null, executionMode: null }))
            .toBe("suggest_only");
    });

    it("honors DEFAULT_EXECUTION_MODE for personal", () => {
        process.env.DEFAULT_EXECUTION_MODE = "require_approval";
        expect(getEffectiveExecutionMode({ executionMode: null })).toBe("require_approval");
    });

    it("uses org field when set", () => {
        expect(getEffectiveExecutionMode({
            organizationId: orgId,
            executionMode: "auto_execute",
        })).toBe("auto_execute");
    });

    it("explicit org executionMode beats DEFAULT_EXECUTION_MODE and grandfather", () => {
        process.env.DEFAULT_EXECUTION_MODE = "require_approval";
        process.env.GRANDFATHER_AUTO_TENANTS = orgId;

        expect(getEffectiveExecutionMode({ organizationId: null, executionMode: null }))
            .toBe("require_approval");
        expect(getEffectiveExecutionMode({
            organizationId: orgId,
            executionMode: "suggest_only",
        })).toBe("suggest_only");
        expect(getEffectiveExecutionMode({
            organizationId: orgId,
            executionMode: "require_approval",
        })).toBe("require_approval");

        delete process.env.GRANDFATHER_AUTO_TENANTS;
        expect(getEffectiveExecutionMode({
            organizationId: orgId,
            executionMode: "suggest_only",
        })).toBe("suggest_only");
        expect(getEffectiveExecutionMode({
            organizationId: orgId,
            executionMode: null,
        })).toBe("require_approval");
    });

    it("grandfather list applies only when org executionMode is unset", () => {
        process.env.GRANDFATHER_AUTO_TENANTS = orgId;
        expect(getEffectiveExecutionMode({
            organizationId: orgId,
            executionMode: null,
        })).toBe("auto_execute");
        expect(getEffectiveExecutionMode({
            organizationId: orgId,
            executionMode: "suggest_only",
        })).toBe("suggest_only");
    });
});

describe("execution mode flags", () => {
    it("parseDefaultExecutionMode falls back on invalid", () => {
        expect(parseDefaultExecutionMode("nope")).toBe("suggest_only");
        expect(parseDefaultExecutionMode("auto_execute")).toBe("auto_execute");
    });

    it("isExecutionModeEnforce is always on", () => {
        expect(isExecutionModeEnforce()).toBe(true);
    });
});

describe("suggestion ingress", () => {
    it("isSuggestionIngressEnabled is always on", () => {
        expect(isSuggestionIngressEnabled()).toBe(true);
    });

    it("shouldBlockExecutionEnqueue is true only for suggest_only", () => {
        expect(shouldBlockExecutionEnqueue("suggest_only")).toBe(true);
        expect(shouldBlockExecutionEnqueue("auto_execute")).toBe(false);
        expect(shouldBlockExecutionEnqueue("require_approval")).toBe(false);
    });
});

describe("accept creates execution", () => {
    it("never enables execution from accept; assert is a no-op", () => {
        expect(isAcceptCreatesExecutionEnabled()).toBe(false);
        expect(() => assertAcceptCreatesCoordinationOnly()).not.toThrow();
    });
});

describe("work inbox UI", () => {
    it("isWorkInboxUiEnabled is always on", () => {
        expect(isWorkInboxUiEnabled()).toBe(true);
    });
});

describe("coordination board flag", () => {
    it("defaults COORDINATION_BOARD off", () => {
        delete process.env.COORDINATION_BOARD;
        expect(isCoordinationBoardEnabled()).toBe(false);
        expect(isCoordinationBoardEnabled("0")).toBe(false);
    });

    it("enables COORDINATION_BOARD when set", () => {
        expect(isCoordinationBoardEnabled("1")).toBe(true);
        expect(isCoordinationBoardEnabled("true")).toBe(true);
    });
});

describe("org dashboard flag", () => {
    it("defaults ORG_DASHBOARD off", () => {
        delete process.env.ORG_DASHBOARD;
        expect(isOrgDashboardEnabled()).toBe(false);
        expect(isOrgDashboardEnabled("0")).toBe(false);
    });

    it("enables ORG_DASHBOARD when set", () => {
        expect(isOrgDashboardEnabled("1")).toBe(true);
        expect(isOrgDashboardEnabled("true")).toBe(true);
    });
});

describe("classifier mode flag", () => {
    it("defaults TASK_CLASSIFIER_MODE to llm", () => {
        delete process.env.TASK_CLASSIFIER_MODE;
        expect(getClassifierMode()).toBe("llm");
        expect(getClassifierMode("")).toBe("llm");
        expect(getClassifierMode("   ")).toBe("llm");
        expect(getClassifierMode("shadow")).toBe("shadow");
        expect(getClassifierMode("llm")).toBe("llm");
        expect(getClassifierMode("regex")).toBe("regex");
        expect(getClassifierMode("nope")).toBe("regex");
    });
});
