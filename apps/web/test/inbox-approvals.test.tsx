/**
 * @jest-environment jsdom
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TaskApprovalRecord } from "@/lib/utils/api";

const getTaskApprovals = jest.fn();
const decideTaskApproval = jest.fn();
const listOrganizations = jest.fn();

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
    getTaskApprovals: (...args: unknown[]) => getTaskApprovals(...args),
    decideTaskApproval: (...args: unknown[]) => decideTaskApproval(...args),
    listOrganizations: (...args: unknown[]) => listOrganizations(...args),
}));

import { InboxApprovalsView } from "@/components/work-suggestions/inbox-approvals";

function renderWithQuery(ui: React.ReactElement) {
    const client = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function buildApproval(overrides: Partial<TaskApprovalRecord> = {}): TaskApprovalRecord {
    return {
        _id: "action-1",
        taskId: "task-1",
        conversationId: "conv-1",
        actorType: "agent",
        actorId: "actor-1",
        actionType: "send_email",
        toolName: "send_email",
        messageId: null,
        parameters: { to: ["a@example.com"], subject: "Welcome", body: "Hello" },
        executionState: "approval_pending",
        summary: "Send welcome email",
        error: null,
        patch: {
            before: null,
            after: {
                policyDecision: {
                    reasons: ["Tool requires manager approval"],
                },
            },
        },
        reason: "",
        idempotencyKey: "idem-1",
        createdAt: "2026-08-08T10:00:00.000Z",
        ...overrides,
    };
}

describe("InboxApprovalsView", () => {
    beforeEach(() => {
        getTaskApprovals.mockReset();
        decideTaskApproval.mockReset();
        listOrganizations.mockReset();
        listOrganizations.mockResolvedValue([
            {
                id: "507f1f77bcf86cd799439015",
                name: "Acme",
                slug: "acme",
                status: "active",
                createdBy: "user-1",
                createdAt: "2026-08-08T10:00:00.000Z",
                updatedAt: "2026-08-08T10:00:00.000Z",
                role: "owner",
            },
        ]);
        window.localStorage.clear();
        window.localStorage.setItem("semantask.activeOrganizationId", "507f1f77bcf86cd799439015");
    });

    it("shows loading then empty state", async () => {
        let resolveLoad: (value: { approvals: TaskApprovalRecord[] }) => void = () => undefined;
        getTaskApprovals.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveLoad = resolve;
                })
        );

        renderWithQuery(<InboxApprovalsView />);
        expect(await screen.findByTestId("inbox-approvals-loading")).toBeInTheDocument();
        await waitFor(() => {
            expect(getTaskApprovals).toHaveBeenCalled();
        });

        resolveLoad({ approvals: [] });
        expect(await screen.findByTestId("inbox-approvals-empty")).toBeInTheDocument();
        expect(screen.queryByTestId("suggestion-accept")).not.toBeInTheDocument();
        expect(screen.queryByTestId("suggestion-dismiss")).not.toBeInTheDocument();
        expect(screen.queryByTestId("suggestion-assign")).not.toBeInTheDocument();
        await waitFor(() => {
            expect(getTaskApprovals).toHaveBeenCalledWith({
                conversationId: undefined,
                organizationId: "507f1f77bcf86cd799439015",
            });
        });
    });

    it("lists approvals and calls decideTaskApproval on Approve", async () => {
        getTaskApprovals.mockResolvedValue({ approvals: [buildApproval()] });
        decideTaskApproval.mockResolvedValue({ approval: buildApproval({ executionState: "approved" }) });

        renderWithQuery(<InboxApprovalsView />);

        expect(await screen.findByTestId("inbox-approvals-list")).toBeInTheDocument();
        expect(screen.getByText("send_email")).toBeInTheDocument();
        expect(screen.getByTestId("approval-email-preview")).toHaveTextContent("a@example.com");
        expect(screen.getByTestId("inbox-approvals-approve")).toHaveTextContent("Approve");

        fireEvent.click(screen.getByTestId("inbox-approvals-approve"));

        await waitFor(() => {
            expect(decideTaskApproval).toHaveBeenCalledWith(
                expect.objectContaining({
                    taskActionId: "action-1",
                    decision: "approve",
                    parameters: { to: ["a@example.com"], subject: "Welcome", body: "Hello" },
                })
            );
        });
    });

    it("shows error and retry when API fails", async () => {
        getTaskApprovals
            .mockRejectedValueOnce(new ApiHttpError(500, "boom"))
            .mockResolvedValueOnce({ approvals: [] });

        renderWithQuery(<InboxApprovalsView />);

        expect(await screen.findByTestId("inbox-approvals-error")).toBeInTheDocument();
        fireEvent.click(screen.getByTestId("inbox-approvals-retry"));

        await waitFor(() => {
            expect(getTaskApprovals).toHaveBeenCalledTimes(2);
        });
        expect(await screen.findByTestId("inbox-approvals-empty")).toBeInTheDocument();
    });

    it("does not fetch organization-wide approvals for members", async () => {
        listOrganizations.mockResolvedValue([
            {
                id: "507f1f77bcf86cd799439015",
                name: "Acme",
                slug: "acme",
                status: "active",
                createdBy: "user-1",
                createdAt: "2026-08-08T10:00:00.000Z",
                updatedAt: "2026-08-08T10:00:00.000Z",
                role: "member",
            },
        ]);

        renderWithQuery(<InboxApprovalsView />);

        const error = await screen.findByTestId("inbox-approvals-error");
        expect(error).toHaveTextContent(/owners and admins/i);
        expect(getTaskApprovals).not.toHaveBeenCalled();
    });

    it("surfaces forbidden access clearly for unauthorized callers", async () => {
        getTaskApprovals.mockRejectedValue(new ApiHttpError(403, "Forbidden"));

        renderWithQuery(<InboxApprovalsView />);

        const error = await screen.findByTestId("inbox-approvals-error");
        expect(error).toHaveTextContent(/permission/i);
    });

    it("keeps the list mounted when parameter JSON is invalid", async () => {
        getTaskApprovals.mockResolvedValue({ approvals: [buildApproval()] });

        renderWithQuery(<InboxApprovalsView />);
        expect(await screen.findByTestId("inbox-approvals-list")).toBeInTheDocument();

        fireEvent.change(screen.getByTestId("inbox-approvals-params"), {
            target: { value: "not-json" },
        });
        fireEvent.click(screen.getByTestId("inbox-approvals-approve"));

        expect(await screen.findByTestId("inbox-approvals-action-error")).toHaveTextContent(
            "invalid JSON"
        );
        expect(screen.getByTestId("inbox-approvals-list")).toBeInTheDocument();
        expect(screen.getByTestId("inbox-approvals-params")).toHaveValue("not-json");
        expect(decideTaskApproval).not.toHaveBeenCalled();
    });
});
