import { beforeEach, describe, expect, it } from "@jest/globals";

jest.mock("@semantask/db", () => ({
    connectToDatabase: jest.fn().mockResolvedValue(undefined),
}));

const findOne = jest.fn();
const findOneAndUpdate = jest.fn();

jest.mock("@semantask/db/models/OrganizationPolicy", () => ({
    __esModule: true,
    default: {
        findOne: (...args: unknown[]) => findOne(...args),
        findOneAndUpdate: (...args: unknown[]) => findOneAndUpdate(...args),
    },
    EXECUTION_MODES: ["suggest_only", "require_approval", "auto_execute"],
    PROMPT_GUARD_MODES: ["off", "monitor", "enforce"],
}));

jest.mock("../organization.service", () => ({
    assertCanManageMembers: jest.fn().mockResolvedValue(undefined),
    assertMembership: jest.fn().mockResolvedValue(undefined),
}));

import * as config from "../config";
import {
    getEffectiveExecutionMode,
    serializeOrganizationPolicy,
    isAcceptCreatesExecutionEnabled,
    isCoordinationBoardEnabled,
    isOrgDashboardEnabled,
    isExecutionModeEnforce,
    isSuggestionIngressEnabled,
    isWorkInboxUiEnabled,
    parseDefaultExecutionMode,
    shouldBlockExecutionEnqueue,
    upsertOrganizationPolicy,
} from "../organization-policy.service";

describe("organization-policy.service config re-exports", () => {
    it("re-exports the shared config parsers by identity", () => {
        expect(getEffectiveExecutionMode).toBe(config.getEffectiveExecutionMode);
        expect(isExecutionModeEnforce).toBe(config.isExecutionModeEnforce);
        expect(parseDefaultExecutionMode).toBe(config.parseDefaultExecutionMode);
        expect(isSuggestionIngressEnabled).toBe(config.isSuggestionIngressEnabled);
        expect(shouldBlockExecutionEnqueue).toBe(config.shouldBlockExecutionEnqueue);
        expect(isAcceptCreatesExecutionEnabled).toBe(config.isAcceptCreatesExecutionEnabled);
        expect(isWorkInboxUiEnabled).toBe(config.isWorkInboxUiEnabled);
        expect(isCoordinationBoardEnabled).toBe(config.isCoordinationBoardEnabled);
        expect(isOrgDashboardEnabled).toBe(config.isOrgDashboardEnabled);
    });
});

describe("upsertOrganizationPolicy executionMode CAS", () => {
    beforeEach(() => {
        findOne.mockReset();
        findOneAndUpdate.mockReset();
    });

    it("retries on concurrent version conflict and audits the committed transition", async () => {
        const orgId = "507f1f77bcf86cd799439011";
        const actorId = "507f1f77bcf86cd799439012";
        const infoSpy = jest.spyOn(console, "info").mockImplementation(() => undefined);

        findOne
            .mockReturnValueOnce({
                lean: async () => ({
                    organizationId: orgId,
                    version: 1,
                    executionMode: "suggest_only",
                }),
            })
            .mockReturnValueOnce({
                lean: async () => ({
                    organizationId: orgId,
                    version: 2,
                    executionMode: "require_approval",
                }),
            });

        findOneAndUpdate
            .mockReturnValueOnce({ lean: async () => null })
            .mockReturnValueOnce({
                lean: async () => ({
                    organizationId: orgId,
                    version: 3,
                    executionMode: "auto_execute",
                    executionModeUpdatedBy: actorId,
                }),
            });

        const updated = await upsertOrganizationPolicy({
            organizationId: orgId,
            actorUserId: actorId,
            executionMode: "auto_execute",
        });

        expect(updated.executionMode).toBe("auto_execute");
        expect(updated.version).toBe(3);
        expect(findOneAndUpdate).toHaveBeenCalledTimes(2);
        expect(infoSpy).toHaveBeenCalledTimes(1);
        const audit = JSON.parse(String(infoSpy.mock.calls[0]?.[0]));
        expect(audit.event).toBe("policy.execution_mode.changed");
        expect(audit.previousMode).toBe("require_approval");
        expect(audit.executionMode).toBe("auto_execute");
        expect(audit.actorUserId).toBe(actorId);
        expect(audit.version).toBe(3);

        infoSpy.mockRestore();
    });

    it("persists toolExecutionModes and rejects an unknown tool", async () => {
        const orgId = "507f1f77bcf86cd799439011";
        findOne.mockReturnValue({
            lean: async () => null,
        });
        findOneAndUpdate.mockReturnValue({
            lean: async () => ({
                organizationId: orgId,
                version: 1,
                toolExecutionModes: { send_email: "suggest_only" },
            }),
        });

        await upsertOrganizationPolicy({
            organizationId: orgId,
            actorUserId: "507f1f77bcf86cd799439012",
            toolExecutionModes: { send_email: "suggest_only" },
        });

        const update = findOneAndUpdate.mock.calls[0]?.[1] as { $set: { toolExecutionModes: unknown } };
        expect(update.$set.toolExecutionModes).toEqual({ send_email: "suggest_only" });

        await expect(upsertOrganizationPolicy({
            organizationId: orgId,
            actorUserId: "507f1f77bcf86cd799439012",
            toolExecutionModes: { not_a_tool: "off" } as never,
        })).rejects.toThrow(/Unknown tool/);
    });
});

describe("serializeOrganizationPolicy toolExecutionModes", () => {
    it("returns null when the document has no per-tool modes", () => {
        const serialized = serializeOrganizationPolicy(null, "507f1f77bcf86cd799439011");
        expect(serialized.toolExecutionModes).toBeNull();
    });
});
