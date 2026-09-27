/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TaskRecord } from "@semantask/types";

const getTask = jest.fn();
const requestTaskExecutionApi = jest.fn();
const authenticatedFetch = jest.fn();

class ApiHttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
        this.name = "ApiHttpError";
    }
}

jest.mock("@/lib/utils/api", () => ({
    ApiHttpError,
    getTask: (...args: unknown[]) => getTask(...args),
    requestTaskExecutionApi: (...args: unknown[]) => requestTaskExecutionApi(...args),
    authenticatedFetch: (...args: unknown[]) => authenticatedFetch(...args),
}));

import { WorkTaskDetailView } from "@/components/work/work-task-detail";

function buildTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
    return {
        _id: "task-1",
        conversationId: "conv-1",
        conversationLabel: "Hiring",
        parentTaskId: null,
        suggestionId: "sug-1",
        title: "Send welcome email to new hire",
        description: "Send a professional welcome email to the new hire by Friday.",
        status: "pending",
        boardStatus: "todo",
        lifecycleState: "waiting_for_approval",
        priority: "medium",
        assignees: ["user-1"],
        coordinationStatus: "AWAITING_APPROVAL",
        ownerRef: { id: "user-1", username: "Alex" },
        executionActions: [
            {
                _id: "action-1",
                taskId: "task-1",
                conversationId: "conv-1",
                actorType: "user",
                actorId: "user-1",
                actionType: "send_email",
                toolName: "send_email",
                messageId: "msg-1",
                parameters: {},
                executionState: "approval_pending",
                summary: "Proposed send email",
                error: null,
                patch: { before: null, after: null },
                reason: "Approval required",
                idempotencyKey: "idem-1",
                createdAt: "2026-08-26T10:00:00.000Z",
            },
        ],
        dueAt: "2026-08-28T00:00:00.000Z",
        createdBy: "user-1",
        source: "ai",
        sourceMessageIds: ["msg-1"],
        latestContextMessageId: "msg-1",
        confidence: 0.9,
        tags: [],
        dedupeKey: "d1",
        subTasks: [],
        dependencyIds: [],
        retryCount: 0,
        maxRetries: 2,
        progress: 0,
        checkpoints: [],
        executionHistory: { attempts: 0, failures: 0, results: [] },
        result: { success: false, confidence: 0, evidence: null },
        version: 1,
        closedAt: null,
        archivedAt: null,
        updatedBy: null,
        createdAt: "2026-08-26T10:00:00.000Z",
        updatedAt: "2026-08-26T10:00:00.000Z",
        ...overrides,
    };
}

describe("WorkTaskDetailView", () => {
    beforeEach(() => {
        getTask.mockReset();
        requestTaskExecutionApi.mockReset();
        authenticatedFetch.mockReset();
    });

    it("renders owner, derived status, source, and timeline", async () => {
        getTask.mockResolvedValue(buildTask());
        render(<WorkTaskDetailView taskId="task-1" />);

        expect(await screen.findByTestId("work-task-detail")).toBeInTheDocument();
        expect(screen.getByTestId("work-task-status")).toHaveTextContent("Awaiting approval");
        expect(screen.getByTestId("work-task-owner")).toHaveTextContent("Alex");
        expect(screen.getByTestId("work-task-source")).toHaveAttribute("href", "/c/conv-1?msg=msg-1");
        expect(screen.getByTestId("work-task-timeline")).toHaveTextContent("Approval requested");
    });

    it("retries a failed execution through the existing request API", async () => {
        getTask
            .mockResolvedValueOnce(
                buildTask({
                    coordinationStatus: "OPEN",
                    executionActions: [
                        {
                            _id: "action-1",
                            taskId: "task-1",
                            conversationId: "conv-1",
                            actorType: "agent",
                            actorId: null,
                            actionType: "send_email",
                            toolName: "send_email",
                            messageId: null,
                            parameters: {},
                            executionState: "failed",
                            summary: "Send failed",
                            error: "SMTP timeout",
                            patch: { before: null, after: null },
                            reason: "failed",
                            idempotencyKey: "idem-1",
                            createdAt: "2026-08-26T10:00:00.000Z",
                        },
                    ],
                })
            )
            .mockResolvedValue(buildTask());
        requestTaskExecutionApi.mockResolvedValue({ enqueued: true });

        render(<WorkTaskDetailView taskId="task-1" />);
        fireEvent.click(await screen.findByTestId("work-task-retry"));

        await waitFor(() => {
            expect(requestTaskExecutionApi).toHaveBeenCalledWith("task-1", {
                reason: "Retry failed execution.",
            });
        });
    });
});
