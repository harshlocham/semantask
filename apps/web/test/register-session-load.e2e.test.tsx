/**
 * @jest-environment jsdom
 *
 * After email OTP verify, register calls login then refreshUser() while still
 * on /register. Initial mount still skips public auth routes; explicit refresh
 * must load /api/me so the session can be established.
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const getMe = jest.fn();
const ensureAuthReady = jest.fn(async () => undefined);
const consumeBootstrappedMe = jest.fn(() => null);

jest.mock("@/lib/auth/authBootstrap", () => ({
    resetAuthBootstrap: jest.fn(),
    ensureAuthReady: (...args: unknown[]) => ensureAuthReady(...args),
    consumeBootstrappedMe: (...args: unknown[]) => consumeBootstrappedMe(...args),
    isAuthenticated: true,
}));

jest.mock("@/lib/utils/api", () => ({
    getMe: (...args: unknown[]) => getMe(...args),
}));

import { UserProvider, useUser } from "@/context/UserContext";
import { isPublicAuthRoute } from "@/lib/utils/auth/client-session";

function RefreshProbe({ onResult }: { onResult: (user: unknown) => void }) {
    const { refreshUser } = useUser();
    return (
        <button
            type="button"
            onClick={() => {
                void refreshUser().then(onResult);
            }}
        >
            refresh
        </button>
    );
}

describe("email register session load (e2e)", () => {
    beforeEach(() => {
        getMe.mockReset();
        ensureAuthReady.mockReset();
        ensureAuthReady.mockResolvedValue(undefined);
        consumeBootstrappedMe.mockReset();
        consumeBootstrappedMe.mockReturnValue(null);
        getMe.mockResolvedValue({ _id: "u1", email: "sohansinghharsh@gmail.com" });
        window.history.pushState({}, "", "/register");
    });

    it("treats /register as a public auth route", () => {
        expect(isPublicAuthRoute("/register")).toBe(true);
        expect(isPublicAuthRoute("/login")).toBe(true);
        expect(isPublicAuthRoute("/")).toBe(false);
    });

    it("refreshUser loads /api/me on /register after a successful login", async () => {
        const sessionUser = { _id: "u1", email: "sohansinghharsh@gmail.com" };
        const onResult = jest.fn();

        render(
            <UserProvider>
                <RefreshProbe onResult={onResult} />
            </UserProvider>
        );

        await waitFor(() => {
            expect(getMe).not.toHaveBeenCalled();
            expect(ensureAuthReady).not.toHaveBeenCalled();
        });

        fireEvent.click(screen.getByRole("button", { name: "refresh" }));

        await waitFor(() => {
            expect(onResult).toHaveBeenCalledWith(sessionUser);
        });

        expect(ensureAuthReady).toHaveBeenCalledTimes(1);
        expect(getMe).toHaveBeenCalledTimes(1);
    });
});
