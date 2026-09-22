/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import type { WorkSuggestionRecord } from "@semantask/types";
import { WorkSuggestionDetailView } from "@/components/work-suggestions/work-suggestion-detail";

function buildSuggestion(overrides: Partial<WorkSuggestionRecord> = {}): WorkSuggestionRecord {
    return {
        _id: "sug-1",
        messageId: "msg-1",
        conversationId: "conv-1",
        organizationId: null,
        intentId: null,
        status: "proposed",
        title: "Send welcome email",
        summary: "Follow up with the new hire",
        confidence: 0.88,
        candidates: {
            assigneeCandidates: [],
            dueAtCandidate: null,
            priorityCandidate: "",
        },
        dismissReason: null,
        convertedTaskId: null,
        extractorVersion: "intelligent-v6-message-intent",
        createdAt: "2026-08-08T10:00:00.000Z",
        updatedAt: "2026-08-08T10:00:00.000Z",
        ...overrides,
    };
}

describe("WorkSuggestionDetailView", () => {
    it("shows loading state", () => {
        render(
            <WorkSuggestionDetailView
                loading
                errorStatus={null}
                errorMessage={null}
                suggestion={null}
            />
        );
        expect(screen.getByTestId("work-suggestion-loading")).toBeInTheDocument();
    });

    it("shows forbidden state for 403", () => {
        render(
            <WorkSuggestionDetailView
                loading={false}
                errorStatus={403}
                errorMessage="Forbidden"
                suggestion={null}
            />
        );
        expect(screen.getByTestId("work-suggestion-forbidden")).toHaveTextContent("Forbidden");
        expect(screen.getByRole("link", { name: /back to chat/i })).toHaveAttribute("href", "/app");
    });

    it("shows not found state for 404", () => {
        render(
            <WorkSuggestionDetailView
                loading={false}
                errorStatus={404}
                errorMessage="Not found"
                suggestion={null}
            />
        );
        expect(screen.getByTestId("work-suggestion-not-found")).toBeInTheDocument();
    });

    it("shows generic error state for 500 (page-assigned unexpected failures)", () => {
        render(
            <WorkSuggestionDetailView
                loading={false}
                errorStatus={500}
                errorMessage="Failed to load suggestion"
                suggestion={null}
            />
        );
        expect(screen.getByTestId("work-suggestion-error")).toHaveTextContent(
            "Failed to load suggestion"
        );
        expect(screen.queryByTestId("work-suggestion-not-found")).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: /back to chat/i })).toHaveAttribute("href", "/app");
    });

    it("renders suggestion detail on success", () => {
        render(
            <WorkSuggestionDetailView
                loading={false}
                errorStatus={null}
                errorMessage={null}
                suggestion={buildSuggestion()}
            />
        );
        const detail = screen.getByTestId("work-suggestion-detail");
        expect(detail).toHaveTextContent("Send welcome email");
        expect(detail).toHaveTextContent("Follow up with the new hire");
        expect(detail).toHaveTextContent("88%");
        expect(screen.getByTestId("source-message-link")).toHaveTextContent("Open source message");
        expect(screen.getByTestId("source-message-link")).toHaveAttribute(
            "href",
            "/c/conv-1?msg=msg-1"
        );
        expect(screen.getByRole("link", { name: /back to chat/i })).toHaveAttribute(
            "href",
            "/c/conv-1"
        );
        expect(screen.getByTestId("work-suggestion-actions")).toBeInTheDocument();
        expect(screen.getByTestId("suggestion-accept")).toBeInTheDocument();
        expect(screen.getByTestId("suggestion-dismiss")).toBeInTheDocument();
    });

    it("shows assign controls for converted suggestions", () => {
        render(
            <WorkSuggestionDetailView
                loading={false}
                errorStatus={null}
                errorMessage={null}
                suggestion={buildSuggestion({
                    status: "converted",
                    convertedTaskId: "task-1",
                })}
            />
        );
        expect(screen.getByTestId("converted-task-id")).toHaveTextContent("Open converted task");
        expect(screen.getByTestId("converted-task-link")).toHaveAttribute("href", "/work/task-1");
        expect(screen.getByTestId("suggestion-assign")).toBeInTheDocument();
        expect(screen.getByTestId("suggestion-accept")).toBeDisabled();
    });

    it("shows Allow AI tools for converted suggestions with a task id", () => {
        const onAllowAiTools = jest.fn(async () => undefined);
        render(
            <WorkSuggestionDetailView
                loading={false}
                errorStatus={null}
                errorMessage={null}
                suggestion={buildSuggestion({
                    status: "converted",
                    convertedTaskId: "task-1",
                })}
                onAllowAiTools={onAllowAiTools}
            />
        );
        expect(screen.getByTestId("suggestion-allow-ai-tools")).toHaveTextContent("Allow AI tools");
        expect(screen.getByText(/separate from accepting a suggestion/i)).toBeInTheDocument();
        fireEvent.click(screen.getByTestId("suggestion-allow-ai-tools"));
        expect(onAllowAiTools).toHaveBeenCalledTimes(1);
    });
});
