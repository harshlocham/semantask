import { Types } from "mongoose";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@semantask/db", () => ({
    connectToDatabase: jest.fn().mockResolvedValue(undefined as never),
}));

const createTaskAction = jest.fn<any>();
jest.mock("../repositories/task.repo", () => ({
    buildTaskActionIdempotencyKey: (taskId: string, actionType: string, sourceId?: string | null) =>
        [taskId, actionType, sourceId ?? ""].join("::"),
    createTaskAction: (...args: unknown[]) => createTaskAction(...args),
}));

const notifyApprovalRequired = jest.fn<any>();
jest.mock("../notify-approval.service", () => ({
    notifyApprovalRequired: (...args: unknown[]) => notifyApprovalRequired(...args),
}));

const messageFindById = jest.fn<any>();
jest.mock("@semantask/db/models/Message", () => ({
    __esModule: true,
    default: {
        findById: (...args: unknown[]) => messageFindById(...args),
    },
}));

const actionFindOne = jest.fn<any>();
jest.mock("@semantask/db/models/TaskAction", () => ({
    __esModule: true,
    default: {
        findOne: (...args: unknown[]) => actionFindOne(...args),
    },
}));

import { proposeExecutionFromSuggestion } from "../execution-proposal.service";
import type { ITask } from "@semantask/db/models/Task";
import type { IWorkSuggestion } from "@semantask/db/models/WorkSuggestion";

describe("proposeExecutionFromSuggestion", () => {
    const taskId = new Types.ObjectId();
    const suggestionId = new Types.ObjectId();
    const conversationId = new Types.ObjectId();
    const organizationId = new Types.ObjectId();
    const messageId = new Types.ObjectId();
    const actorUserId = new Types.ObjectId().toString();
    const actionId = new Types.ObjectId();

    const task = {
        _id: taskId,
        conversationId,
        organizationId,
        title: "Send welcome email to new hire",
    } as ITask;

    const suggestion = {
        _id: suggestionId,
        messageId,
        title: "Send welcome email to new hire",
        summary: "Requested outcome: send welcome email",
        requestedOutcome: "Send a professional welcome email to the new hire by Friday.",
        suggestedTool: "send_email",
        executionPolicy: "approval_required",
    } as IWorkSuggestion;

    beforeEach(() => {
        createTaskAction.mockReset();
        notifyApprovalRequired.mockReset();
        notifyApprovalRequired.mockResolvedValue(undefined);
        messageFindById.mockReset();
        actionFindOne.mockReset();
        messageFindById.mockReturnValue({
            select: () => ({
                lean: jest.fn(async () => ({
                    content: "Send a professional welcome email to the new hire by Friday.",
                })),
            }),
        });
    });

    it("creates an approval_pending proposal and notifies org managers", async () => {
        createTaskAction.mockResolvedValue({
            _id: actionId,
            executionState: "approval_pending",
            idempotencyKey: `${taskId}::proposal:send_email::${suggestionId}`,
        });

        const result = await proposeExecutionFromSuggestion({ task, suggestion, actorUserId });

        expect(result.created).toBe(true);
        expect(createTaskAction).toHaveBeenCalledWith(
            expect.objectContaining({
                toolName: "send_email",
                executionState: "approval_pending",
                idempotencyKey: `${taskId.toString()}::proposal:send_email::${suggestionId.toString()}`,
                parameters: expect.objectContaining({
                    to: ["new hire"],
                }),
            })
        );
        await new Promise((resolve) => setImmediate(resolve));
        expect(notifyApprovalRequired).toHaveBeenCalledWith(
            expect.objectContaining({
                organizationId: organizationId.toString(),
                taskId: taskId.toString(),
                actionId: actionId.toString(),
                actorUserId,
            })
        );
    });

    it("reuses the existing proposal on duplicate key without re-notifying", async () => {
        const existing = { _id: new Types.ObjectId(), executionState: "approval_pending" };
        createTaskAction.mockRejectedValue({ code: 11000 });
        actionFindOne.mockReturnValue({ exec: jest.fn<any>().mockResolvedValue(existing) });

        const first = await proposeExecutionFromSuggestion({ task, suggestion, actorUserId });
        expect(first.created).toBe(false);
        expect(first.action).toBe(existing);
        expect(notifyApprovalRequired).not.toHaveBeenCalled();

        const second = await proposeExecutionFromSuggestion({ task, suggestion, actorUserId });
        expect(second.created).toBe(false);
        expect(createTaskAction).toHaveBeenCalledTimes(2);
        expect(actionFindOne).toHaveBeenCalled();
        expect(notifyApprovalRequired).not.toHaveBeenCalled();
    });

    it("stores prohibited proposals as blocked and does not notify", async () => {
        createTaskAction.mockResolvedValue({
            _id: new Types.ObjectId(),
            executionState: "blocked",
        });

        await proposeExecutionFromSuggestion({
            task,
            suggestion: { ...suggestion, executionPolicy: "prohibited" } as IWorkSuggestion,
            actorUserId,
        });

        expect(createTaskAction).toHaveBeenCalledWith(
            expect.objectContaining({
                executionState: "blocked",
            })
        );
        await new Promise((resolve) => setImmediate(resolve));
        expect(notifyApprovalRequired).not.toHaveBeenCalled();
    });
});
