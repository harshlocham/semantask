/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import { SocketEvents } from "@semantask/types";

const on = jest.fn();
const off = jest.fn();

jest.mock("@/lib/socket/socketClient", () => ({
    getSocket: () => ({ on, off }),
}));

jest.mock("@/context/UserContext", () => ({
    useUser: () => ({ user: { _id: "user-1" } }),
}));

import { NotificationTray } from "@/components/notifications/notification-tray";

describe("NotificationTray", () => {
    beforeEach(() => {
        on.mockReset();
        off.mockReset();
        window.localStorage.clear();
    });

    it("links approval_required items to /inbox/approvals", () => {
        render(<NotificationTray />);
        const handler = on.mock.calls.find(
            (call) => call[0] === SocketEvents.USER_NOTIFICATION
        )?.[1] as (payload: Record<string, unknown>) => void;
        expect(typeof handler).toBe("function");

        handler({
            kind: "approval_required",
            subject: "Approval needed",
            text: "Needs approval",
            entityId: "task-1",
            dedupeKey: "approval:task-1:action-1",
        });

        fireEvent.click(screen.getByTestId("notification-tray-toggle"));
        const link = screen.getByTestId("notification-tray-approvals-link");
        expect(link).toHaveAttribute("href", "/inbox/approvals");
    });

    it("links assigned items to the task page", () => {
        render(<NotificationTray />);
        const handler = on.mock.calls.find(
            (call) => call[0] === SocketEvents.USER_NOTIFICATION
        )?.[1] as (payload: Record<string, unknown>) => void;

        handler({
            kind: "task_assigned",
            subject: "Assigned",
            text: "You were assigned",
            entityId: "task-1",
            dedupeKey: "assign:task-1",
        });

        fireEvent.click(screen.getByTestId("notification-tray-toggle"));
        expect(screen.getByTestId("notification-tray-task-link")).toHaveAttribute(
            "href",
            "/work/task-1"
        );
    });
});
