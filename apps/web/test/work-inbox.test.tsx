/**
 * @jest-environment jsdom
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorkSuggestionRecord } from "@semantask/types";

const listWorkSuggestions = jest.fn();
const acceptWorkSuggestionApi = jest.fn();
const dismissWorkSuggestionApi = jest.fn();
const assignWorkSuggestionApi = jest.fn();
const getOrganizationMembers = jest.fn();
const listOrganizations = jest.fn();
const decideTaskApproval = jest.fn();
const requestTaskExecutionApi = jest.fn();
const getWorkSuggestion = jest.fn();
const refreshConversation = jest.fn(async () => undefined);

const mockInboxSearch = { value: "" };

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
    listWorkSuggestions: (...args: unknown[]) => listWorkSuggestions(...args),
    acceptWorkSuggestionApi: (...args: unknown[]) => acceptWorkSuggestionApi(...args),
    dismissWorkSuggestionApi: (...args: unknown[]) => dismissWorkSuggestionApi(...args),
    assignWorkSuggestionApi: (...args: unknown[]) => assignWorkSuggestionApi(...args),
    getOrganizationMembers: (...args: unknown[]) => getOrganizationMembers(...args),
    listOrganizations: (...args: unknown[]) => listOrganizations(...args),
    decideTaskApproval: (...args: unknown[]) => decideTaskApproval(...args),
    requestTaskExecutionApi: (...args: unknown[]) => requestTaskExecutionApi(...args),
    getWorkSuggestion: (...args: unknown[]) => getWorkSuggestion(...args),
}));

jest.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(mockInboxSearch.value),
}));

jest.mock("@/store/work-suggestion-store", () => {
    const store = (selector: (state: { refreshConversation: typeof refreshConversation }) => unknown) =>
        selector({ refreshConversation });
    return {
        __esModule: true,
        default: store,
    };
});

import { WorkInboxView } from "@/components/work-suggestions/work-inbox";

function renderWithQuery(ui: React.ReactElement) {
    const client = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function buildSuggestion(overrides: Partial<WorkSuggestionRecord> = {}): WorkSuggestionRecord {
    return {
        _id: "sug-1",
        messageId: "msg-1",
        conversationId: "507f1f77bcf86cd799439014",
        organizationId: "507f1f77bcf86cd799439015",
        intentId: null,
        status: "proposed",
        title: "Send welcome email",
        summary: "Follow up with the new hire",
        confidence: 0.88,
        candidates: {
            assigneeCandidates: ["507f1f77bcf86cd799439099"],
            dueAtCandidate: null,
            priorityCandidate: "",
        },
        dismissReason: null,
        convertedTaskId: null,
        extractorVersion: "intelligent-v7",
        createdAt: "2026-08-08T10:00:00.000Z",
        updatedAt: "2026-08-08T10:00:00.000Z",
        ...overrides,
    };
}

describe("WorkInboxView", () => {
    beforeEach(() => {
        listWorkSuggestions.mockReset();
        acceptWorkSuggestionApi.mockReset();
        dismissWorkSuggestionApi.mockReset();
        assignWorkSuggestionApi.mockReset();
        getOrganizationMembers.mockReset();
        listOrganizations.mockReset();
        decideTaskApproval.mockReset();
        requestTaskExecutionApi.mockReset();
        getWorkSuggestion.mockReset();
        refreshConversation.mockClear();
        mockInboxSearch.value = "";
        window.localStorage.clear();
        getOrganizationMembers.mockResolvedValue([]);
        listOrganizations.mockResolvedValue([
            {
                id: "507f1f77bcf86cd799439015",
                name: "Acme",
                slug: "acme",
                status: "active",
                createdBy: "u1",
                createdAt: "2026-08-08T10:00:00.000Z",
                updatedAt: "2026-08-08T10:00:00.000Z",
                role: "owner",
            },
        ]);
    });

    it("shows onboarding when no org or conversation scope is set", async () => {
        renderWithQuery(<WorkInboxView />);
        expect(await screen.findByTestId("work-inbox-onboarding")).toBeInTheDocument();
        expect(listWorkSuggestions).not.toHaveBeenCalled();
        expect(screen.queryByTestId("suggestion-accept")).not.toBeInTheDocument();
        expect(screen.queryByTestId("suggestion-dismiss")).not.toBeInTheDocument();
        expect(requestTaskExecutionApi).not.toHaveBeenCalled();
        expect(decideTaskApproval).not.toHaveBeenCalled();
    });

    it("uses the review queue tabs to select existing statuses", async () => {
        renderWithQuery(<WorkInboxView />);
        expect(await screen.findByTestId("work-inbox-status")).toHaveValue("proposed");
        expect(screen.getByTestId("work-inbox-queue-proposed")).toHaveAttribute("aria-pressed", "true");

        fireEvent.click(screen.getByTestId("work-inbox-queue-converted"));
        expect(screen.getByTestId("work-inbox-status")).toHaveValue("converted");
        expect(screen.getByTestId("work-inbox-queue-converted")).toHaveAttribute("aria-pressed", "true");

        fireEvent.click(screen.getByTestId("work-inbox-queue-dismissed"));
        expect(screen.getByTestId("work-inbox-status")).toHaveValue("dismissed");
        expect(listWorkSuggestions).not.toHaveBeenCalled();
    });

    it("loads org-scoped suggestions with triage actions and links to detail", async () => {
        window.localStorage.setItem("semantask.activeOrganizationId", "507f1f77bcf86cd799439015");
        listWorkSuggestions.mockResolvedValue({
            items: [buildSuggestion()],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });

        renderWithQuery(<WorkInboxView />);

        await waitFor(() => {
            expect(listWorkSuggestions).toHaveBeenCalledWith({
                organizationId: "507f1f77bcf86cd799439015",
                conversationId: undefined,
                status: "proposed",
                page: 1,
                limit: 20,
            });
        });

        expect(await screen.findByTestId("work-inbox-list")).toBeInTheDocument();
        const link = screen.getByTestId("work-inbox-row-link");
        expect(link).toHaveAttribute("href", "/work-suggestions/sug-1");
        expect(screen.getByTestId("work-inbox-conversation-link")).toHaveAttribute(
            "href",
            "/c/507f1f77bcf86cd799439014"
        );
        expect(await screen.findByTestId("suggestion-accept")).toHaveTextContent("Accept & assign");
        expect(screen.getByTestId("suggestion-dismiss")).toBeInTheDocument();
        expect(screen.getByTestId("suggestion-assign")).toBeDisabled();
    });

    it("accepts a suggestion, removes it from proposed inbox, and does not call approvals", async () => {
        window.localStorage.setItem("semantask.activeOrganizationId", "507f1f77bcf86cd799439015");
        listWorkSuggestions
            .mockResolvedValueOnce({
                items: [buildSuggestion()],
                pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
            })
            .mockResolvedValue({
                items: [],
                pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
            });
        acceptWorkSuggestionApi.mockResolvedValue({
            suggestion: buildSuggestion({ status: "converted", convertedTaskId: "task-1" }),
            task: {
                _id: "task-1",
                assignees: ["507f1f77bcf86cd799439099"],
            },
        });

        renderWithQuery(<WorkInboxView />);
        expect(await screen.findByTestId("suggestion-accept")).toBeInTheDocument();

        fireEvent.click(screen.getByTestId("suggestion-accept"));

        await waitFor(() => {
            expect(acceptWorkSuggestionApi).toHaveBeenCalledWith("sug-1", {});
        });
        expect(decideTaskApproval).not.toHaveBeenCalled();
        expect(requestTaskExecutionApi).not.toHaveBeenCalled();
        expect(await screen.findByTestId("work-inbox-empty")).toBeInTheDocument();
        expect(refreshConversation).toHaveBeenCalledWith("507f1f77bcf86cd799439014");
    });

    it("requests execution via Allow AI tools on converted rows only", async () => {
        window.localStorage.setItem("semantask.activeOrganizationId", "507f1f77bcf86cd799439015");
        listWorkSuggestions.mockResolvedValue({
            items: [
                buildSuggestion({
                    status: "converted",
                    convertedTaskId: "task-1",
                }),
            ],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
        requestTaskExecutionApi.mockResolvedValue({
            taskAction: { _id: "action-1", executionState: "requested" },
            enqueued: true,
            alreadyPending: false,
        });

        renderWithQuery(<WorkInboxView />);
        fireEvent.change(await screen.findByTestId("work-inbox-status"), {
            target: { value: "converted" },
        });

        expect(requestTaskExecutionApi).not.toHaveBeenCalled();
        fireEvent.click(await screen.findByTestId("suggestion-allow-ai-tools"));

        await waitFor(() => {
            expect(requestTaskExecutionApi).toHaveBeenCalledWith("task-1", {
                reason: "Manager requested AI tool execution from work inbox",
            });
        });
        expect(acceptWorkSuggestionApi).not.toHaveBeenCalled();
        expect(decideTaskApproval).not.toHaveBeenCalled();
    });

    it("highlights the row matching ?suggestion=", async () => {
        window.localStorage.setItem("semantask.activeOrganizationId", "507f1f77bcf86cd799439015");
        mockInboxSearch.value = "suggestion=sug-1";
        getWorkSuggestion.mockResolvedValue(buildSuggestion());
        listWorkSuggestions.mockResolvedValue({
            items: [buildSuggestion()],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });

        renderWithQuery(<WorkInboxView />);
        const row = await screen.findByTestId("work-inbox-row");
        expect(row).toHaveAttribute("data-highlighted", "true");
        expect(row).toHaveAttribute("id", "inbox-suggestion-sug-1");
        await waitFor(() => {
            expect(listWorkSuggestions).toHaveBeenCalledWith({
                organizationId: "507f1f77bcf86cd799439015",
                conversationId: "507f1f77bcf86cd799439014",
                status: "proposed",
                page: 1,
                limit: 20,
            });
        });
    });

    it("loads personal work from ?conversationId= without an active organization", async () => {
        mockInboxSearch.value = "suggestion=sug-1&conversationId=507f1f77bcf86cd799439014";
        getWorkSuggestion.mockResolvedValue(buildSuggestion({ status: "converted" }));
        listWorkSuggestions.mockResolvedValue({
            items: [buildSuggestion({ status: "converted" })],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });

        renderWithQuery(<WorkInboxView />);

        await waitFor(() => {
            expect(listWorkSuggestions).toHaveBeenCalledWith({
                organizationId: "507f1f77bcf86cd799439015",
                conversationId: "507f1f77bcf86cd799439014",
                status: "converted",
                page: 1,
                limit: 20,
            });
        });
        expect(await screen.findByTestId("work-inbox-row")).toHaveAttribute("data-highlighted", "true");
        expect(screen.queryByTestId("work-inbox-onboarding")).not.toBeInTheDocument();
    });

    it("opens the page that contains a deep-linked suggestion", async () => {
        window.localStorage.setItem("semantask.activeOrganizationId", "507f1f77bcf86cd799439015");
        mockInboxSearch.value = "suggestion=sug-2";
        getWorkSuggestion.mockResolvedValue(buildSuggestion({
            _id: "sug-2",
            status: "proposed",
        }));
        listWorkSuggestions.mockImplementation(async (params: unknown) => {
            const page = (params as { page?: number }).page ?? 1;
            if (page === 2) {
                return {
                    items: [buildSuggestion({ _id: "sug-2" })],
                    pagination: { page: 2, limit: 20, total: 21, totalPages: 2 },
                };
            }
            return {
                items: [buildSuggestion()],
                pagination: { page: 1, limit: 20, total: 21, totalPages: 2 },
            };
        });

        renderWithQuery(<WorkInboxView />);

        await waitFor(() => {
            expect(screen.getByTestId("work-inbox-row")).toHaveAttribute("id", "inbox-suggestion-sug-2");
        });
        expect(screen.getByTestId("work-inbox-row")).toHaveAttribute("data-highlighted", "true");
        expect(listWorkSuggestions).toHaveBeenCalledWith(
            expect.objectContaining({ page: 2, status: "proposed" })
        );
    });

    it("scopes a deep-linked org suggestion to its organizationId", async () => {
        window.localStorage.setItem("semantask.activeOrganizationId", "507f1f77bcf86cd799439016");
        mockInboxSearch.value = "suggestion=sug-1";
        getWorkSuggestion.mockResolvedValue(buildSuggestion({
            organizationId: "507f1f77bcf86cd799439015",
        }));
        listWorkSuggestions.mockResolvedValue({
            items: [buildSuggestion()],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });

        renderWithQuery(<WorkInboxView />);

        await waitFor(() => {
            expect(listWorkSuggestions).toHaveBeenCalledWith({
                organizationId: "507f1f77bcf86cd799439015",
                conversationId: "507f1f77bcf86cd799439014",
                status: "proposed",
                page: 1,
                limit: 20,
            });
        });
    });

    it("clears organization scope for a personal deep-linked suggestion", async () => {
        window.localStorage.setItem("semantask.activeOrganizationId", "507f1f77bcf86cd799439015");
        mockInboxSearch.value = "suggestion=sug-1";
        getWorkSuggestion.mockResolvedValue(buildSuggestion({
            organizationId: null,
            status: "proposed",
        }));
        listWorkSuggestions.mockResolvedValue({
            items: [buildSuggestion({ organizationId: null })],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });

        renderWithQuery(<WorkInboxView />);

        await waitFor(() => {
            expect(listWorkSuggestions).toHaveBeenCalledWith({
                organizationId: undefined,
                conversationId: "507f1f77bcf86cd799439014",
                status: "proposed",
                page: 1,
                limit: 20,
            });
        });
    });

    it("requires dismiss reason and removes row after dismiss", async () => {
        window.localStorage.setItem("semantask.activeOrganizationId", "507f1f77bcf86cd799439015");
        listWorkSuggestions
            .mockResolvedValueOnce({
                items: [buildSuggestion()],
                pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
            })
            .mockResolvedValue({
                items: [],
                pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
            });
        dismissWorkSuggestionApi.mockResolvedValue(
            buildSuggestion({ status: "dismissed", dismissReason: "Not useful" })
        );

        renderWithQuery(<WorkInboxView />);
        const dismiss = await screen.findByTestId("suggestion-dismiss");
        expect(dismiss).toBeDisabled();

        fireEvent.change(screen.getByTestId("suggestion-dismiss-reason"), {
            target: { value: "Not useful" },
        });
        expect(dismiss).not.toBeDisabled();
        fireEvent.click(dismiss);

        await waitFor(() => {
            expect(dismissWorkSuggestionApi).toHaveBeenCalledWith("sug-1", "Not useful");
        });
        expect(await screen.findByTestId("work-inbox-empty")).toBeInTheDocument();
    });

    it("assigns owner on converted suggestions and updates displayed owner", async () => {
        window.localStorage.setItem("semantask.activeOrganizationId", "507f1f77bcf86cd799439015");
        getOrganizationMembers.mockResolvedValue([
            {
                id: "mem-1",
                userId: "507f1f77bcf86cd799439088",
                role: "member",
                createdAt: "2026-08-08T10:00:00.000Z",
                user: {
                    id: "507f1f77bcf86cd799439088",
                    username: "Alex",
                    email: "alex@example.com",
                },
            },
        ]);
        listWorkSuggestions.mockResolvedValue({
            items: [
                buildSuggestion({
                    status: "converted",
                    convertedTaskId: "task-1",
                    candidates: {
                        assigneeCandidates: ["507f1f77bcf86cd799439088"],
                        dueAtCandidate: null,
                        priorityCandidate: "",
                    },
                }),
            ],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
        assignWorkSuggestionApi.mockResolvedValue({
            suggestion: buildSuggestion({
                status: "converted",
                convertedTaskId: "task-1",
            }),
            task: {
                _id: "task-1",
                assignees: ["507f1f77bcf86cd799439088"],
            },
        });

        renderWithQuery(<WorkInboxView />);

        // Switch to converted filter so the converted row is requested
        fireEvent.change(await screen.findByTestId("work-inbox-status"), {
            target: { value: "converted" },
        });

        await waitFor(() => {
            expect(listWorkSuggestions).toHaveBeenCalledWith(
                expect.objectContaining({ status: "converted" })
            );
        });

        const assignees = await screen.findByTestId("suggestion-assignees");
        await waitFor(() => {
            expect(assignees).toHaveValue("507f1f77bcf86cd799439088");
        });
        fireEvent.click(screen.getByTestId("suggestion-assign"));

        await waitFor(() => {
            expect(assignWorkSuggestionApi).toHaveBeenCalledWith("sug-1", {
                assignees: ["507f1f77bcf86cd799439088"],
            });
        });
        expect(await screen.findByTestId("work-inbox-owner")).toHaveTextContent("Alex");
    });

    it("restores the row when accept fails", async () => {
        window.localStorage.setItem("semantask.activeOrganizationId", "507f1f77bcf86cd799439015");
        listWorkSuggestions.mockResolvedValue({
            items: [buildSuggestion()],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
        acceptWorkSuggestionApi.mockRejectedValue(new ApiHttpError(404, "Work suggestion not found"));

        renderWithQuery(<WorkInboxView />);
        fireEvent.click(await screen.findByTestId("suggestion-accept"));

        expect(await screen.findByTestId("suggestion-action-error")).toHaveTextContent(
            "Work suggestion not found"
        );
        expect(screen.getByTestId("work-inbox-row")).toBeInTheDocument();
        expect(screen.getByTestId("work-inbox-row-link")).toHaveTextContent("Send welcome email");
    });

    it("shows empty state when API returns no items", async () => {
        window.localStorage.setItem("semantask.activeOrganizationId", "507f1f77bcf86cd799439015");
        listWorkSuggestions.mockResolvedValue({
            items: [],
            pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
        });

        renderWithQuery(<WorkInboxView />);
        expect(await screen.findByTestId("work-inbox-empty")).toHaveTextContent(
            "No proposed suggestions"
        );
    });

    it("shows error state with retry", async () => {
        window.localStorage.setItem("semantask.activeOrganizationId", "507f1f77bcf86cd799439015");
        listWorkSuggestions.mockRejectedValue(new Error("Forbidden"));

        renderWithQuery(<WorkInboxView />);
        expect(await screen.findByTestId("work-inbox-error")).toHaveTextContent("Forbidden");
        expect(screen.getByTestId("work-inbox-retry")).toBeInTheDocument();
    });
});
