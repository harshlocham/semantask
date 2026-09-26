/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { WorkspaceShell } from "@/components/shell/workspace-shell";

var mockPathname = "/inbox";
var mockOrganizationId: string | null = null;
var mockOrgs: Array<{ id: string; name: string; role: string }> = [];
var mockSuggestionTotal: number | undefined;
var mockApprovalLength: number | undefined;

jest.mock("next/navigation", () => ({
    usePathname: () => mockPathname,
    useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/hooks/useActiveOrganizationId", () => ({
    useActiveOrganizationId: () => mockOrganizationId,
    writeActiveOrganizationId: jest.fn(),
    readActiveOrganizationId: () => mockOrganizationId,
    ACTIVE_ORGANIZATION_STORAGE_KEY: "semantask.activeOrganizationId",
    ACTIVE_ORGANIZATION_CHANGED_EVENT: "semantask:active-organization",
}));

jest.mock("@/lib/queries/use-organizations", () => ({
    useOrganizationsList: () => ({ data: mockOrgs, isLoading: false, isError: false }),
}));

jest.mock("@/lib/queries/use-work-suggestions", () => ({
    useWorkSuggestionsList: () => ({
        data: mockSuggestionTotal === undefined
            ? undefined
            : {
                items: [],
                pagination: { page: 1, limit: 1, total: mockSuggestionTotal, totalPages: 1 },
            },
    }),
}));

jest.mock("@/lib/queries/use-task-approvals", () => ({
    useTaskApprovalsList: () => ({
        data: mockApprovalLength === undefined
            ? undefined
            : Array.from({ length: mockApprovalLength }, (_, index) => ({ _id: `approval-${index}` })),
    }),
}));

jest.mock("@/components/home/userProfile", () => ({
    __esModule: true,
    default: function UserProfileMock() {
        return <button type="button" aria-label="Open profile settings">Ada</button>;
    },
}));

jest.mock("@/lib/socket/socketClient", () => ({
    getSocket: () => ({ connected: false, disconnect: jest.fn() }),
}));

function renderShell(flags?: { boardEnabled?: boolean; dashboardEnabled?: boolean }) {
    return render(
        <WorkspaceShell
            boardEnabled={flags?.boardEnabled}
            dashboardEnabled={flags?.dashboardEnabled}
        >
            <p>page body</p>
        </WorkspaceShell>
    );
}

describe("WorkspaceShell", () => {
    beforeEach(() => {
        mockPathname = "/inbox";
        mockOrganizationId = null;
        mockOrgs = [];
        mockSuggestionTotal = undefined;
        mockApprovalLength = undefined;
    });

    it("renders conversations, suggestions, and approvals", () => {
        renderShell();
        expect(screen.getByTestId("workspace-nav-conversations")).toHaveAttribute("href", "/app");
        expect(screen.getByTestId("inbox-nav-suggestions")).toHaveAttribute("href", "/inbox");
        expect(screen.getByTestId("inbox-nav-approvals")).toHaveAttribute("href", "/inbox/approvals");
        expect(screen.getByText("page body")).toBeInTheDocument();
    });

    it("hides board and dashboard until their flags are on", () => {
        const view = renderShell();
        expect(screen.queryByTestId("inbox-nav-board")).toBeNull();
        expect(screen.queryByTestId("inbox-nav-dashboard")).toBeNull();

        view.rerender(
            <WorkspaceShell boardEnabled dashboardEnabled>
                <p>page body</p>
            </WorkspaceShell>
        );
        expect(screen.getByTestId("inbox-nav-board")).toHaveAttribute("href", "/inbox/board");
        expect(screen.getByTestId("inbox-nav-dashboard")).toHaveAttribute("href", "/inbox/dashboard");
    });

    it("marks approvals current on the approvals route", () => {
        mockPathname = "/inbox/approvals";
        renderShell();
        expect(screen.getByTestId("inbox-nav-approvals")).toHaveAttribute("aria-current", "page");
        expect(screen.getByTestId("inbox-nav-suggestions")).not.toHaveAttribute("aria-current", "page");
    });

    it("does not show pending counts for a personal workspace", () => {
        mockSuggestionTotal = 4;
        mockApprovalLength = 2;
        renderShell();
        expect(screen.queryByTestId("nav-suggestion-count")).toBeNull();
        expect(screen.queryByTestId("nav-approval-count")).toBeNull();
    });

    it("shows pending counts from the organization queries", () => {
        mockOrganizationId = "org-1";
        mockOrgs = [{ id: "org-1", name: "Acme", role: "owner" }];
        mockSuggestionTotal = 4;
        mockApprovalLength = 2;
        renderShell();
        expect(screen.getByTestId("nav-suggestion-count")).toHaveTextContent("4");
        expect(screen.getByTestId("nav-approval-count")).toHaveTextContent("2");
    });

    it("ignores a stored organization the current user does not belong to", () => {
        mockOrganizationId = "org-from-another-account";
        mockSuggestionTotal = 4;
        mockApprovalLength = 2;
        renderShell();
        expect(screen.queryByTestId("nav-suggestion-count")).toBeNull();
        expect(screen.queryByTestId("nav-approval-count")).toBeNull();
    });

    it("opens the same links from the mobile navigation button", () => {
        renderShell({ boardEnabled: true });
        const menu = screen.getByRole("button", { name: "Open navigation" });
        expect(menu).toHaveAttribute("aria-expanded", "false");

        fireEvent.click(menu);

        const dialog = screen.getByRole("dialog");
        expect(menu).toHaveAttribute("aria-expanded", "true");
        expect(within(dialog).getByTestId("workspace-nav-conversations")).toBeInTheDocument();
        expect(within(dialog).getByTestId("inbox-nav-suggestions")).toBeInTheDocument();
        expect(within(dialog).getByTestId("inbox-nav-approvals")).toBeInTheDocument();
        expect(within(dialog).getByTestId("inbox-nav-board")).toBeInTheDocument();
    });
});
