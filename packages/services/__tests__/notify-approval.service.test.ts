import { Types } from "mongoose";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@semantask/db", () => ({
    connectToDatabase: jest.fn(async () => undefined),
}));

const membershipFind = jest.fn<any>();
jest.mock("@semantask/db/models/OrganizationMembership", () => ({
    __esModule: true,
    default: {
        find: (...args: unknown[]) => membershipFind(...args),
    },
}));

const notifyUsers = jest.fn<any>();
jest.mock("../notify.service", () => ({
    notifyUsers: (...args: unknown[]) => notifyUsers(...args),
}));

import { notifyApprovalRequired } from "../notify-approval.service";

describe("notifyApprovalRequired", () => {
    const organizationId = new Types.ObjectId().toString();
    const taskId = new Types.ObjectId().toString();
    const actionId = new Types.ObjectId().toString();
    const actorUserId = new Types.ObjectId().toString();
    const managerId = new Types.ObjectId().toString();
    const conversationId = new Types.ObjectId().toString();

    beforeEach(() => {
        membershipFind.mockReset();
        notifyUsers.mockReset();
        notifyUsers.mockResolvedValue(undefined);
        delete process.env.APP_URL;
        delete process.env.PUBLIC_APP_URL;
    });

    it("fans out to org owner/admin and excludes the actor", async () => {
        membershipFind.mockReturnValue({
            select: () => ({
                limit: () => ({
                    lean: async () => [
                        { userId: { toString: () => managerId } },
                        { userId: { toString: () => actorUserId } },
                    ],
                }),
            }),
        });

        await notifyApprovalRequired({
            organizationId,
            taskId,
            actionId,
            title: "Coordinate launch",
            conversationId,
            actorUserId,
        });

        expect(notifyUsers).toHaveBeenCalledTimes(1);
        expect(notifyUsers.mock.calls[0][0]).toEqual([managerId]);
        const payload = notifyUsers.mock.calls[0][1] as {
            kind: string;
            dedupeKey: string;
            entityId: string;
        };
        expect(payload.kind).toBe("approval_required");
        expect(payload.dedupeKey).toBe(`approval:${taskId}:${actionId}`);
        expect(payload.entityId).toBe(taskId);
    });

    it("appends absolute approvals CTA when APP_URL is set", async () => {
        process.env.APP_URL = "https://app.example.com";
        membershipFind.mockReturnValue({
            select: () => ({
                limit: () => ({
                    lean: async () => [{ userId: { toString: () => managerId } }],
                }),
            }),
        });

        await notifyApprovalRequired({
            organizationId,
            taskId,
            actionId,
            title: "Coordinate launch",
            conversationId,
            actorUserId,
        });

        const payload = notifyUsers.mock.calls[0][1] as { html: string; text: string };
        expect(payload.html).toContain('href="https://app.example.com/inbox/approvals"');
        expect(payload.text).toContain("https://app.example.com/inbox/approvals");
    });

    it("no-ops when organization id is invalid", async () => {
        await notifyApprovalRequired({
            organizationId: "bad",
            taskId,
            actionId,
            title: "Coordinate launch",
            conversationId,
        });
        expect(membershipFind).not.toHaveBeenCalled();
        expect(notifyUsers).not.toHaveBeenCalled();
    });
});
