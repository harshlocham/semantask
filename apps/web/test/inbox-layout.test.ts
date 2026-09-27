/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";

jest.mock("next/navigation", () => ({
    usePathname: () => "/inbox",
    useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@semantask/services/organization-policy.service", () => ({
    isCoordinationBoardEnabled: jest.fn(() => false),
    isOrgDashboardEnabled: jest.fn(() => false),
}));

jest.mock("@/lib/queries/use-organizations", () => ({
    useOrganizationsList: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/lib/queries/use-work-suggestions", () => ({
    useWorkSuggestionsList: () => ({ data: undefined }),
}));

jest.mock("@/lib/queries/use-task-approvals", () => ({
    useTaskApprovalsList: () => ({ data: undefined }),
}));

jest.mock("@/components/home/userProfile", () => ({
    __esModule: true,
    default: () => null,
}));

jest.mock("@/lib/socket/socketClient", () => ({
    getSocket: () => ({ connected: false, disconnect: jest.fn() }),
}));

import InboxLayout from "../app/inbox/layout";

describe("InboxLayout", () => {
    it("renders children through the shell", () => {
        render(React.createElement(InboxLayout, null, "child"));
        expect(screen.getByText("child")).toBeInTheDocument();
        expect(screen.getByTestId("inbox-subnav")).toBeInTheDocument();
        expect(screen.getByTestId("inbox-nav-suggestions")).toBeInTheDocument();
        expect(screen.queryByTestId("inbox-nav-board")).toBeNull();
    });
});
