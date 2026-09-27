/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const searchComposeDirectory = jest.fn();
const createConversation = jest.fn();
const createOrganizationInvitation = jest.fn();
const getUsers = jest.fn();
const setSelectedConversation = jest.fn();

jest.mock("next/image", () => ({
    __esModule: true,
    default: (props: { alt?: string }) => React.createElement("img", { alt: props.alt ?? "" }),
}));

jest.mock("@imagekit/next", () => ({
    upload: jest.fn(),
}), { virtual: true });

jest.mock("@/lib/utils/imagekit", () => ({
    getImageKitUploadAuth: jest.fn(),
}));

jest.mock("react-hot-toast", () => ({
    __esModule: true,
    default: { success: jest.fn(), error: jest.fn() },
}));

jest.mock("@/store/chat-store", () => ({
    __esModule: true,
    default: (selector: (state: { setSelectedConversation: typeof setSelectedConversation }) => unknown) =>
        selector({ setSelectedConversation }),
}));

jest.mock("@/context/UserContext", () => ({
    useUser: () => ({
        user: {
            _id: "507f1f77bcf86cd799439011",
            username: "Ada",
            email: "ada@example.com",
            isOnline: false,
            role: "user",
            status: "active",
            lastSeen: "",
            isVerified: false,
            conversations: [],
            createdAt: "",
            updatedAt: "",
        },
    }),
}));

jest.mock("@/lib/utils/api", () => ({
    searchComposeDirectory: (...args: unknown[]) => searchComposeDirectory(...args),
    createConversation: (...args: unknown[]) => createConversation(...args),
    createOrganizationInvitation: (...args: unknown[]) => createOrganizationInvitation(...args),
    getUsers: (...args: unknown[]) => getUsers(...args),
}));

import UserListDialog from "@/components/home/dialogs/user-list-dialog";

const bob = {
    id: "507f1f77bcf86cd799439012",
    username: "Bob",
    email: "bob@example.com",
    profilePicture: null,
    existingDirectConversationId: "507f1f77bcf86cd799439021",
};

const carol = {
    id: "507f1f77bcf86cd799439013",
    username: "Carol",
    email: "carol@example.com",
    profilePicture: null,
    existingDirectConversationId: null,
};

function directory(input: {
    suggestions?: unknown[];
    results?: unknown[];
    nextCursor?: string | null;
    invite?: { email: string } | null;
}) {
    return {
        success: true,
        suggestions: input.suggestions ?? [],
        results: input.results ?? [],
        nextCursor: input.nextCursor ?? null,
        invite: input.invite ?? null,
    };
}

function renderDialog() {
    render(<UserListDialog open onOpenChange={() => undefined} hideTrigger />);
}

describe("UserListDialog", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        window.localStorage.clear();
        searchComposeDirectory.mockResolvedValue(directory({ suggestions: [bob, carol] }));
        createConversation.mockResolvedValue("507f1f77bcf86cd799439099");
    });

    it("loads suggestions and does not request the global user list", async () => {
        renderDialog();

        expect(await screen.findByText("Bob", { exact: true })).toBeInTheDocument();
        expect(screen.getByText("Recent")).toBeInTheDocument();
        expect(getUsers).not.toHaveBeenCalled();
        expect(searchComposeDirectory).toHaveBeenCalledWith(
            expect.objectContaining({ q: undefined })
        );
        expect(searchComposeDirectory.mock.calls[0]?.[0]).not.toHaveProperty("cursor");
    });

    it("shows a loading state and then an empty state", async () => {
        let resolveDirectory: (value: ReturnType<typeof directory>) => void = () => undefined;
        searchComposeDirectory.mockReturnValue(
            new Promise((resolve) => {
                resolveDirectory = resolve;
            })
        );
        renderDialog();

        expect(await screen.findByText("Loading people")).toBeInTheDocument();
        resolveDirectory(directory({}));
        expect(await screen.findByText("No recent people")).toBeInTheDocument();
    });

    it("shows an error state when suggestions fail", async () => {
        searchComposeDirectory.mockRejectedValue(new Error("offline"));
        renderDialog();

        expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    });

    it("sends a debounced search query and renders server results", async () => {
        searchComposeDirectory.mockImplementation(async (input: { q?: string }) => {
            if (input.q === "Carol") return directory({ results: [carol] });
            return directory({ suggestions: [bob] });
        });
        renderDialog();
        expect(await screen.findByText("Bob", { exact: true })).toBeInTheDocument();

        fireEvent.change(screen.getByRole("searchbox", { name: "Search people" }), {
            target: { value: "Carol" },
        });

        expect(await screen.findByText("Carol", { exact: true })).toBeInTheDocument();
        await waitFor(() => {
            expect(searchComposeDirectory).toHaveBeenCalledWith(
                expect.objectContaining({ q: "Carol" })
            );
        });
        expect(screen.queryByText("Bob", { exact: true })).not.toBeInTheDocument();
    });

    it("opens the conversation returned for an existing direct message", async () => {
        createConversation.mockResolvedValue(bob.existingDirectConversationId);
        renderDialog();
        fireEvent.click(await screen.findByText("Bob", { exact: true }));
        expect(screen.getByRole("button", { name: /Bob/ })).toHaveAttribute("aria-pressed", "true");

        fireEvent.click(screen.getByRole("button", { name: "Create" }));

        await waitFor(() => {
            expect(createConversation).toHaveBeenCalledWith({
                participants: [bob.id, "507f1f77bcf86cd799439011"],
                isGroup: false,
                admin: undefined,
                groupName: undefined,
                image: undefined,
            });
        });
        expect(setSelectedConversation).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: bob.existingDirectConversationId,
                isGroup: false,
                type: "direct",
            })
        );
    });

    it("creates a new direct conversation for a person without one", async () => {
        searchComposeDirectory.mockResolvedValue(directory({ suggestions: [carol] }));
        createConversation.mockResolvedValue("507f1f77bcf86cd799439030");
        renderDialog();
        fireEvent.click(await screen.findByText("Carol", { exact: true }));
        fireEvent.click(screen.getByRole("button", { name: "Create" }));

        await waitFor(() => {
            expect(setSelectedConversation).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: "507f1f77bcf86cd799439030",
                    isGroup: false,
                })
            );
        });
    });

    it("reveals the group composer after two people are selected", async () => {
        renderDialog();
        fireEvent.click(await screen.findByText("Bob", { exact: true }));
        fireEvent.click(screen.getByText("Carol", { exact: true }));

        expect(screen.getByRole("heading", { name: "New group" })).toBeInTheDocument();
        expect(screen.getByPlaceholderText("Group name")).toBeInTheDocument();
        fireEvent.change(screen.getByPlaceholderText("Group name"), {
            target: { value: "Engineering Planning" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Create" }));

        await waitFor(() => {
            expect(createConversation).toHaveBeenCalledWith(
                expect.objectContaining({
                    participants: [bob.id, carol.id, "507f1f77bcf86cd799439011"],
                    isGroup: true,
                    groupName: "Engineering Planning",
                    admin: "507f1f77bcf86cd799439011",
                })
            );
        });
    });

    it("offers an invite link when an exact email has no eligible person", async () => {
        searchComposeDirectory.mockImplementation(async (input: { q?: string }) => {
            if (input.q === "erin@example.com") {
                return directory({ invite: { email: "erin@example.com" } });
            }
            return directory({ suggestions: [bob] });
        });
        renderDialog();
        await screen.findByText("Bob", { exact: true });
        fireEvent.change(screen.getByRole("searchbox", { name: "Search people" }), {
            target: { value: "erin@example.com" },
        });

        expect(await screen.findByRole("link", { name: "Invite erin@example.com" })).toHaveAttribute(
            "href",
            "/organizations"
        );
        expect(screen.getByText("No person found")).toBeInTheDocument();
    });

    it("moves between people with the arrow keys", async () => {
        renderDialog();
        await screen.findByText("Bob", { exact: true });
        const list = screen.getByRole("list", { name: "People" });
        const bobButton = screen.getByRole("button", { name: /Bob/ });
        bobButton.focus();
        fireEvent.keyDown(list, { key: "ArrowDown" });
        expect(screen.getByRole("button", { name: /Carol/ })).toHaveFocus();
    });
});
