/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const authenticatedFetch = jest.fn();
const replace = jest.fn();

jest.mock("next/navigation", () => ({
    useRouter: () => ({ replace }),
}));

jest.mock("@/lib/utils/api", () => ({
    authenticatedFetch: (...args: unknown[]) => authenticatedFetch(...args),
}));

import AccountPage from "@/app/account/page";

describe("AccountPage", () => {
    beforeEach(() => {
        authenticatedFetch.mockReset();
        replace.mockReset();
    });

    it("changes the password through the existing endpoint", async () => {
        authenticatedFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ success: true }),
        });

        render(<AccountPage />);
        fireEvent.change(screen.getByTestId("account-old-password"), {
            target: { value: "current-pass" },
        });
        fireEvent.change(screen.getByTestId("account-new-password"), {
            target: { value: "short" },
        });
        fireEvent.click(screen.getByTestId("account-change-password"));
        expect(screen.getByTestId("account-password-error")).toHaveTextContent("at least 8");
        expect(authenticatedFetch).not.toHaveBeenCalled();

        fireEvent.change(screen.getByTestId("account-new-password"), {
            target: { value: "new-password" },
        });
        fireEvent.click(screen.getByTestId("account-change-password"));

        await waitFor(() => {
            expect(authenticatedFetch).toHaveBeenCalledWith("/api/auth/change-password", {
                method: "POST",
                body: JSON.stringify({ oldPassword: "current-pass", newPassword: "new-password" }),
            });
        });
        expect(replace).toHaveBeenCalledWith("/login");
    });

    it("revokes every session through the existing endpoint", async () => {
        authenticatedFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ success: true }),
        });

        render(<AccountPage />);
        fireEvent.click(screen.getByTestId("account-revoke-sessions"));

        await waitFor(() => {
            expect(authenticatedFetch).toHaveBeenCalledWith("/api/auth/revoke-all-tokens", {
                method: "POST",
            });
        });
        expect(replace).toHaveBeenCalledWith("/login");
    });
});
