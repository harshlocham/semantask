/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorkSuggestionRecord } from "@semantask/types";

const acceptWorkSuggestionApi = jest.fn();
const dismissWorkSuggestionApi = jest.fn();
const requestTaskExecutionApi = jest.fn();
const applySuggestion = jest.fn();
const push = jest.fn();

jest.mock("next/navigation", () => ({
    useRouter: () => ({ push }),
}));

jest.mock("@/lib/utils/api", () => ({
    acceptWorkSuggestionApi: (...args: unknown[]) => acceptWorkSuggestionApi(...args),
    dismissWorkSuggestionApi: (...args: unknown[]) => dismissWorkSuggestionApi(...args),
    requestTaskExecutionApi: (...args: unknown[]) => requestTaskExecutionApi(...args),
}));

jest.mock("@/store/work-suggestion-store", () => {
    const store = (selector: (state: { applySuggestion: typeof applySuggestion }) => unknown) =>
        selector({ applySuggestion });
    return { __esModule: true, default: store };
});

import { ConversationSuggestionCard } from "@/components/chat/conversation-suggestion-card";

function buildSuggestion(overrides: Partial<WorkSuggestionRecord> = {}): WorkSuggestionRecord {
    return {
        _id: "sug-1",
        messageId: "msg-1",
        conversationId: "conv-1",
        organizationId: null,
        intentId: null,
        status: "proposed",
        title: "Send the Q3 update",
        summary: "Email the team the Q3 numbers",
        requestedOutcome: "Email the team the Q3 numbers",
        confidence: 0.82,
        suggestedTool: "send_email",
        candidates: {
            assigneeCandidates: ["user-1"],
            dueAtCandidate: "2026-09-30T00:00:00.000Z",
            priorityCandidate: "high",
        },
        dismissReason: null,
        convertedTaskId: null,
        extractorVersion: "v1",
        createdAt: "2026-09-23T10:00:00.000Z",
        updatedAt: "2026-09-23T10:00:00.000Z",
        ...overrides,
    };
}

describe("ConversationSuggestionCard", () => {
    beforeEach(() => {
        acceptWorkSuggestionApi.mockReset();
        dismissWorkSuggestionApi.mockReset();
        requestTaskExecutionApi.mockReset();
        applySuggestion.mockReset();
        push.mockReset();
    });

    it("shows suggestion fields and does not start tools on accept", async () => {
        const converted = buildSuggestion({
            status: "converted",
            convertedTaskId: "task-1",
        });
        acceptWorkSuggestionApi.mockResolvedValue({ suggestion: converted, task: { _id: "task-1" } });

        render(<ConversationSuggestionCard suggestion={buildSuggestion()} />);

        expect(screen.getByTestId("conversation-suggestion-note")).toHaveTextContent(
            "This is a suggestion, not a task yet."
        );
        expect(screen.getByTestId("conversation-suggestion-outcome")).toHaveTextContent(
            "Email the team the Q3 numbers"
        );
        expect(screen.getByText("1 suggested")).toBeInTheDocument();
        expect(screen.getByText("high")).toBeInTheDocument();
        expect(screen.getByText("82%")).toBeInTheDocument();
        expect(screen.queryByTestId("conversation-suggestion-tools")).toBeNull();

        fireEvent.click(screen.getByTestId("conversation-suggestion-accept"));

        await waitFor(() => {
            expect(acceptWorkSuggestionApi).toHaveBeenCalledWith("sug-1");
        });
        expect(requestTaskExecutionApi).not.toHaveBeenCalled();
        expect(applySuggestion).toHaveBeenCalledWith("conv-1", converted);
    });

    it("requires a reason before dismiss", async () => {
        dismissWorkSuggestionApi.mockResolvedValue(buildSuggestion({ status: "dismissed" }));
        render(<ConversationSuggestionCard suggestion={buildSuggestion()} />);

        fireEvent.click(screen.getByTestId("conversation-suggestion-dismiss"));
        const reason = screen.getByTestId("conversation-suggestion-dismiss-reason");
        expect(screen.getByTestId("conversation-suggestion-dismiss")).toBeDisabled();

        fireEvent.change(reason, { target: { value: "Already handled" } });
        fireEvent.click(screen.getByTestId("conversation-suggestion-dismiss"));

        await waitFor(() => {
            expect(dismissWorkSuggestionApi).toHaveBeenCalledWith("sug-1", "Already handled");
        });
        expect(requestTaskExecutionApi).not.toHaveBeenCalled();
    });

    it("links a converted suggestion to the task and keeps tool review separate", async () => {
        requestTaskExecutionApi.mockResolvedValue({
            taskAction: { _id: "approval-1" },
            enqueued: false,
            alreadyPending: false,
        });

        render(
            <ConversationSuggestionCard
                suggestion={buildSuggestion({
                    status: "converted",
                    convertedTaskId: "task-9",
                })}
            />
        );

        expect(screen.getByTestId("conversation-suggestion-task-link")).toHaveAttribute(
            "href",
            "/work/task-9"
        );
        expect(screen.queryByTestId("conversation-suggestion-accept")).toBeNull();
        expect(screen.getByTestId("conversation-suggestion-tools")).toHaveTextContent("Send email");

        fireEvent.click(screen.getByTestId("conversation-suggestion-review-action"));

        await waitFor(() => {
            expect(requestTaskExecutionApi).toHaveBeenCalledWith("task-9", {
                reason: "Review action from the conversation suggestion card",
            });
        });
        expect(push).toHaveBeenCalledWith("/inbox/approvals");
    });
});
