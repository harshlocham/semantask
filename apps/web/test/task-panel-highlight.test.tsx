/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import type { TaskRecord } from "@semantask/types";

const mockTaskSearch = { value: "task=task-1" };
const authenticatedFetch = jest.fn();

jest.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(mockTaskSearch.value),
}));

jest.mock("@/lib/utils/api", () => ({
    authenticatedFetch: (...args: unknown[]) => authenticatedFetch(...args),
}));

jest.mock("@/hooks/useTaskExecution", () => ({
    useTaskExecution: () => ({
        steps: [],
        progress: 0,
        runId: null,
        durationMs: null,
        failureReason: null,
        retryStatus: null,
        approvalPending: false,
        phase: null,
        activeTool: null,
        verification: false,
    }),
}));

jest.mock("@/hooks/socketClient", () => ({
    getSocket: () => ({
        on: jest.fn(),
        off: jest.fn(),
    }),
}));

import TaskPanel from "@/components/chat/task-panel";

function buildTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
    return {
        _id: "task-1",
        conversationId: "conv-1",
        parentTaskId: null,
        suggestionId: "sug-1",
        title: "Coordinate launch",
        description: "",
        status: "pending",
        boardStatus: "todo",
        priority: "high",
        assignees: [],
        dueAt: null,
        createdBy: "user-1",
        source: "ai",
        sourceMessageIds: ["msg-1"],
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

describe("TaskPanel deep links", () => {
    beforeEach(() => {
        authenticatedFetch.mockReset();
        mockTaskSearch.value = "task=task-1";
        authenticatedFetch.mockImplementation(async (url: unknown) => {
            if (String(url).includes("execution-events")) {
                return { ok: true, json: async () => ({ events: [] }) };
            }
            return { ok: true, json: async () => [buildTask()] };
        });
    });

    it("highlights the ?task= card and links to /work and the suggestion", async () => {
        render(React.createElement(TaskPanel, { conversationId: "conv-1" }));

        const card = await screen.findByTestId("task-panel-card");
        expect(card).toHaveAttribute("data-highlighted", "true");
        expect(card).toHaveAttribute("id", "task-panel-card-task-1");
        expect(screen.getByTestId("task-panel-task-link")).toHaveAttribute("href", "/work/task-1");
        expect(screen.getByTestId("task-panel-suggestion-link")).toHaveAttribute(
            "href",
            "/work-suggestions/sug-1"
        );
        expect(screen.getByLabelText("Run status")).toBeInTheDocument();
        expect(screen.getByTestId("task-panel")).toHaveAttribute("data-mobile-visible", "true");
    });

    it("opens below the desktop breakpoint when the work control asks for the drawer", async () => {
        mockTaskSearch.value = "";
        render(React.createElement(TaskPanel, { conversationId: "conv-1", mobileOpen: true }));
        expect(await screen.findByTestId("task-panel")).toHaveAttribute("data-mobile-visible", "true");
        expect(screen.getByTestId("task-panel-close")).toBeInTheDocument();
        expect(screen.getByTestId("task-panel-mobile-backdrop")).toBeInTheDocument();
    });
});
