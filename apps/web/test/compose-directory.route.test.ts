import { NextResponse } from "next/server";

class MockAuthorizationError extends Error {
    code: "FORBIDDEN" | "NOT_FOUND";

    constructor(code: "FORBIDDEN" | "NOT_FOUND", message: string) {
        super(message);
        this.code = code;
        this.name = "AuthorizationError";
    }
}

jest.mock("@/lib/utils/auth/requireAuthUser", () => ({
    requireAuthUser: jest.fn(),
}));

jest.mock("@/lib/utils/auth/resolveOrganizationContext", () => ({
    resolveOrganizationContext: jest.fn(),
}));

jest.mock("@semantask/services/authorization.service", () => ({
    AuthorizationError: MockAuthorizationError,
}));

jest.mock("@semantask/services/organization-errors", () => {
    class ValidationError extends Error {
        code = "VALIDATION_ERROR" as const;

        constructor(message: string) {
            super(message);
            this.name = "ValidationError";
        }
    }

    return {
        ValidationError,
        organizationApiErrorStatus: () => 500,
    };
});

const composeDirectory = jest.fn();

jest.mock("@semantask/services/compose-directory.service", () => ({
    composeDirectory: (...args: unknown[]) => composeDirectory(...args),
}));

import { requireAuthUser } from "@/lib/utils/auth/requireAuthUser";
import { resolveOrganizationContext } from "@/lib/utils/auth/resolveOrganizationContext";
import { ValidationError } from "@semantask/services/organization-errors";
import { GET } from "../app/api/directory/compose/route";

const user = {
    id: "507f1f77bcf86cd799439011",
    email: "ada@example.com",
    role: "user" as const,
};

const organizationId = "507f1f77bcf86cd799439015";

const directory = {
    suggestions: [],
    results: [
        {
            id: "507f1f77bcf86cd799439012",
            username: "Bob",
            email: "bob@example.com",
            profilePicture: null,
            existingDirectConversationId: null,
        },
    ],
    nextCursor: null,
    invite: null,
};

describe("GET /api/directory/compose", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuthUser as jest.Mock).mockResolvedValue({ user, response: null });
        (resolveOrganizationContext as jest.Mock).mockResolvedValue({
            organizationId,
            response: null,
        });
        composeDirectory.mockResolvedValue(directory);
    });

    it("rejects an unauthenticated request", async () => {
        (requireAuthUser as jest.Mock).mockResolvedValue({
            user: null,
            response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        });

        const response = await GET(new Request("http://localhost/api/directory/compose"));

        expect(response.status).toBe(401);
        expect(composeDirectory).not.toHaveBeenCalled();
    });

    it("passes the active organization and a clamped query to the service", async () => {
        const response = await GET(
            new Request("http://localhost/api/directory/compose?q=bob&limit=20&cursor=507f1f77bcf86cd799439012", {
                headers: { "X-Organization-Id": organizationId },
            })
        );

        expect(response.status).toBe(200);
        expect(composeDirectory).toHaveBeenCalledWith({
            actorUserId: user.id,
            organizationId,
            query: "bob",
            cursor: "507f1f77bcf86cd799439012",
            limit: 20,
        });
        const body = await response.json();
        expect(body.results).toEqual(directory.results);
        expect(body.results[0]).not.toHaveProperty("password");
        expect(body.results[0]).not.toHaveProperty("tokenVersion");
        expect(body.results[0]).not.toHaveProperty("twoFactorSecret");
    });

    it("uses a null organization for the personal workspace", async () => {
        (resolveOrganizationContext as jest.Mock).mockResolvedValue({
            organizationId: null,
            response: null,
        });

        const response = await GET(new Request("http://localhost/api/directory/compose"));

        expect(response.status).toBe(200);
        expect(composeDirectory).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: null, query: "" })
        );
    });

    it("returns 403 when the service denies the workspace", async () => {
        composeDirectory.mockRejectedValue(new MockAuthorizationError("FORBIDDEN", "Forbidden"));

        const response = await GET(new Request("http://localhost/api/directory/compose?q=bob"));

        expect(response.status).toBe(403);
    });

    it("returns 400 for an invalid cursor", async () => {
        composeDirectory.mockRejectedValue(new ValidationError("Invalid cursor"));

        const response = await GET(
            new Request("http://localhost/api/directory/compose?cursor=nope")
        );

        expect(response.status).toBe(400);
    });

    it("returns 400 for a non-numeric limit", async () => {
        const response = await GET(
            new Request("http://localhost/api/directory/compose?limit=lots")
        );

        expect(response.status).toBe(400);
        expect(composeDirectory).not.toHaveBeenCalled();
    });
});
