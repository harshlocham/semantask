/**
 * @jest-environment jsdom
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TaskRecord } from "@semantask/types";

const listWorkBoard = jest.fn();
const patchTaskApi = jest.fn();
const getTask = jest.fn();
const listOrganizations = jest.fn();

const mockBoardSearch = { value: "" };

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
    listWorkBoard: (...args: unknown[]) => listWorkBoard(...args),
    patchTaskApi: (...args: unknown[]) => patchTaskApi(...args),
    getTask: (...args: unknown[]) => getTask(...args),
    listOrganizations: (...args: unknown[]) => listOrganizations(...args),
}));

jest.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(mockBoardSearch.value),
}));

import { WorkBoardView } from "@/components/work-board/work-board";

function renderWithQuery(ui: React.ReactElement) {
    const client = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function buildTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
    return {
        _id: "task-1",
        conversationId: "507f1f77bcf86cd799439014",
        parentTaskId: null,
        suggestionId: "sug-1",
        title: "Coordinate launch",
        description: "",
        status: "pending",
        boardStatus: "todo",
        priority: "high",
        assignees: [],
        dueAt: null,
        createdBy: "507f1f77bcf86cd799439011",
        source: "ai",
        sourceMessageIds: [],
        latestContextMessageId: null,
        confidence: 0.9,
        tags: [],
        dedupeKey: "suggestion.accept::sug-1",
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
        createdAt: "2026-08-22T10:00:00.000Z",
        updatedAt: "2026-08-22T10:00:00.000Z",
        ...overrides,
    };
}

describe("WorkBoardView", () => {
    beforeEach(() => {
        listWorkBoard.mockReset();
        patchTaskApi.mockReset();
        getTask.mockReset();
        listOrganizations.mockReset();
        listOrganizations.mockResolvedValue([]);
        mockBoardSearch.value = "";
        window.localStorage.clear();
    });

    it("shows onboarding when no org or conversation scope is set", async () => {
        renderWithQuery(<WorkBoardView />);
        expect(await screen.findByTestId("work-board-onboarding")).toBeInTheDocument();
        expect(listWorkBoard).not.toHaveBeenCalled();
    });

    it("moves a card by PATCHing boardStatus only", async () => {
        listOrganizations.mockResolvedValue([
            {
                id: "507f1f77bcf86cd799439015",
                name: "Acme",
                slug: "acme",
                status: "active",
                createdBy: "user-1",
                createdAt: "2026-08-22T10:00:00.000Z",
                updatedAt: "2026-08-22T10:00:00.000Z",
                role: "owner",
            },
        ]);
        window.localStorage.setItem("semantask.activeOrganizationId", "507f1f77bcf86cd799439015");
        const task = buildTask();
        listWorkBoard.mockResolvedValue({
            items: [task],
            pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
        });
        patchTaskApi.mockResolvedValue({ ...task, boardStatus: "doing" });

        renderWithQuery(<WorkBoardView />);

        await waitFor(() => {
            expect(listWorkBoard).toHaveBeenCalledWith({
                organizationId: "507f1f77bcf86cd799439015",
                conversationId: undefined,
                boardStatus: undefined,
                priority: undefined,
                due: undefined,
                page: 1,
                limit: 50,
            });
        });

        expect(await screen.findByTestId("work-board-columns")).toBeInTheDocument();
        const title = screen.getByTestId("work-board-card-title");
        expect(title).toHaveAttribute("href", "/work/task-1");
        expect(title.tagName).toBe("A");
        expect(patchTaskApi).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId("work-board-move-doing"));

        await waitFor(() => {
            expect(patchTaskApi).toHaveBeenCalledWith("task-1", { boardStatus: "doing" });
        });
        expect(patchTaskApi).toHaveBeenCalledTimes(1);
        const [, patch] = patchTaskApi.mock.calls[0] as [string, { boardStatus?: string; status?: string }];
        expect(patch).toEqual({ boardStatus: "doing" });
        expect(patch.status).toBeUndefined();
    });

    it("highlights the card matching ?task=", async () => {
        listOrganizations.mockResolvedValue([
            {
                id: "507f1f77bcf86cd799439015",
                name: "Acme",
                slug: "acme",
                status: "active",
                createdBy: "user-1",
                createdAt: "2026-08-22T10:00:00.000Z",
                updatedAt: "2026-08-22T10:00:00.000Z",
                role: "owner",
            },
        ]);
        window.localStorage.setItem("semantask.activeOrganizationId", "507f1f77bcf86cd799439015");
        mockBoardSearch.value = "task=task-1";
        getTask.mockResolvedValue(buildTask());
        listWorkBoard.mockResolvedValue({
            items: [buildTask()],
            pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
        });

        renderWithQuery(<WorkBoardView />);
        const card = await screen.findByTestId("work-board-card");
        expect(card).toHaveAttribute("data-highlighted", "true");
        expect(screen.getByTestId("work-board-suggestion-link")).toHaveAttribute(
            "href",
            "/work-suggestions/sug-1"
        );
        expect(screen.getByTestId("work-board-conversation-link")).toHaveAttribute(
            "href",
            "/c/507f1f77bcf86cd799439014"
        );
        await waitFor(() => {
            expect(listWorkBoard).toHaveBeenCalledWith({
                organizationId: "507f1f77bcf86cd799439015",
                conversationId: "507f1f77bcf86cd799439014",
                boardStatus: undefined,
                priority: undefined,
                due: undefined,
                page: 1,
                limit: 50,
            });
        });
    });

    it("loads personal work from ?conversationId= without an active organization", async () => {
        mockBoardSearch.value = "task=task-1&conversationId=507f1f77bcf86cd799439014";
        getTask.mockResolvedValue(buildTask());
        listWorkBoard.mockResolvedValue({
            items: [buildTask()],
            pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
        });

        renderWithQuery(<WorkBoardView />);

        await waitFor(() => {
            expect(listWorkBoard).toHaveBeenCalledWith({
                organizationId: undefined,
                conversationId: "507f1f77bcf86cd799439014",
                boardStatus: undefined,
                priority: undefined,
                due: undefined,
                page: 1,
                limit: 50,
            });
        });
        expect(await screen.findByTestId("work-board-card")).toHaveAttribute("data-highlighted", "true");
        expect(screen.queryByTestId("work-board-onboarding")).not.toBeInTheDocument();
    });

    it("opens the page that contains a deep-linked task", async () => {
        listOrganizations.mockResolvedValue([
            {
                id: "507f1f77bcf86cd799439015",
                name: "Acme",
                slug: "acme",
                status: "active",
                createdBy: "user-1",
                createdAt: "2026-08-22T10:00:00.000Z",
                updatedAt: "2026-08-22T10:00:00.000Z",
                role: "owner",
            },
        ]);
        window.localStorage.setItem("semantask.activeOrganizationId", "507f1f77bcf86cd799439015");
        mockBoardSearch.value = "task=task-2";
        getTask.mockResolvedValue(buildTask({ _id: "task-2" }));
        listWorkBoard.mockImplementation(async (params: unknown) => {
            const page = (params as { page?: number }).page ?? 1;
            if (page === 2) {
                return {
                    items: [buildTask({ _id: "task-2" })],
                    pagination: { page: 2, limit: 50, total: 51, totalPages: 2 },
                };
            }
            return {
                items: [buildTask()],
                pagination: { page: 1, limit: 50, total: 51, totalPages: 2 },
            };
        });

        renderWithQuery(<WorkBoardView />);

        await waitFor(() => {
            expect(screen.getByTestId("work-board-card")).toHaveAttribute("id", "board-task-task-2");
        });
        expect(screen.getByTestId("work-board-card")).toHaveAttribute("data-highlighted", "true");
        expect(listWorkBoard).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
    });
});
