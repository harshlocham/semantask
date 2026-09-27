import { NextResponse } from "next/server";

class MockAuthorizationError extends Error {
    code: "FORBIDDEN" | "NOT_FOUND";

    constructor(code: "FORBIDDEN" | "NOT_FOUND", message: string) {
        super(message);
        this.code = code;
        this.name = "AuthorizationError";
    }
}

jest.mock("@/lib/Db/db", () => ({
    connectToDatabase: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/utils/auth/requireAuthUser", () => ({
    requireAuthUser: jest.fn(),
}));

jest.mock("@/lib/utils/auth/resolveOrganizationContext", () => ({
    resolveOrganizationContext: jest.fn(),
}));

jest.mock("@/lib/utils/auth/requireConversationAccess", () => ({
    requireConversationAccess: jest.fn(),
}));

jest.mock("@semantask/services/authorization.service", () => ({
    AuthorizationError: MockAuthorizationError,
}));

const assertUsersAreOrgMembers = jest.fn();
const resolveOrganizationIdForUser = jest.fn();

jest.mock("@semantask/services/organization.service", () => ({
    assertUsersAreOrgMembers: (...args: unknown[]) => assertUsersAreOrgMembers(...args),
    resolveOrganizationIdForUser: (...args: unknown[]) => resolveOrganizationIdForUser(...args),
}));

const userFindById = jest.fn();
const userFindOne = jest.fn();

jest.mock("@/models/User", () => ({
    User: {
        findById: (...args: unknown[]) => userFindById(...args),
        findOne: (...args: unknown[]) => userFindOne(...args),
    },
}));

const conversationFindOne = jest.fn();
const conversationCreate = jest.fn();

jest.mock("@/models/Conversation", () => ({
    Conversation: {
        findOne: (...args: unknown[]) => conversationFindOne(...args),
        create: (...args: unknown[]) => conversationCreate(...args),
    },
}));

jest.mock("@/lib/socket/socketConfig", () => ({
    getInternalSocketServerUrl: () => "http://socket.test",
}));

jest.mock("@semantask/types/utils/internal-bridge-auth", () => ({
    createInternalRequestHeaders: () => ({ "x-internal-secret": "test" }),
}));

import { requireAuthUser } from "@/lib/utils/auth/requireAuthUser";
import { resolveOrganizationContext } from "@/lib/utils/auth/resolveOrganizationContext";
import { POST } from "../app/api/conversations/route";

const actorId = "507f1f77bcf86cd799439011";
const bobId = "507f1f77bcf86cd799439012";
const carolId = "507f1f77bcf86cd799439013";
const danaId = "507f1f77bcf86cd799439014";
const organizationId = "507f1f77bcf86cd799439015";
const existingId = "507f1f77bcf86cd799439021";
const createdId = "507f1f77bcf86cd799439022";

const user = {
    id: actorId,
    email: "ada@example.com",
    role: "user" as const,
};

function postConversation(body: Record<string, unknown>, org: string | null = organizationId) {
    return POST(
        new Request("http://localhost/api/conversations", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(org ? { "X-Organization-Id": org } : {}),
            },
            body: JSON.stringify(body),
        })
    );
}

describe("POST /api/conversations", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuthUser as jest.Mock).mockResolvedValue({ user, response: null });
        (resolveOrganizationContext as jest.Mock).mockImplementation(async () => ({
            organizationId,
            response: null,
        }));
        userFindById.mockResolvedValue({ _id: actorId, email: user.email });
        assertUsersAreOrgMembers.mockResolvedValue(undefined);
        conversationFindOne.mockResolvedValue(null);
        conversationCreate.mockImplementation(async (doc: { participants: string[]; isGroup?: boolean }) => ({
            _id: createdId,
            participants: doc.participants,
            isGroup: doc.isGroup,
            populate: async () => ({
                _id: createdId,
                participants: doc.participants,
                isGroup: Boolean(doc.isGroup),
            }),
        }));
        jest.spyOn(global, "fetch").mockResolvedValue({ ok: true } as Response);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("creates a direct conversation when none exists", async () => {
        const response = await postConversation({
            participants: [actorId, bobId],
            isGroup: false,
        });

        expect(response.status).toBe(201);
        expect(conversationCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                isGroup: false,
                participants: [actorId, bobId],
                organizationId,
            })
        );
        const body = await response.json();
        expect(body._id).toBe(createdId);
    });

    it("reuses an existing direct conversation", async () => {
        conversationFindOne.mockResolvedValue({
            _id: existingId,
            populate: async () => ({ _id: existingId, isGroup: false }),
        });

        const response = await postConversation({
            participants: [actorId, bobId],
            isGroup: false,
        });

        expect(response.status).toBe(200);
        expect(conversationCreate).not.toHaveBeenCalled();
        const findFilter = conversationFindOne.mock.calls[0]?.[0] as { isGroup: boolean };
        expect(findFilter.isGroup).toBe(false);
        const body = await response.json();
        expect(body._id).toBe(existingId);
    });

    it("creates a group conversation", async () => {
        const response = await postConversation({
            participants: [actorId, bobId, carolId],
            isGroup: true,
            groupName: "Engineering Planning",
            admin: actorId,
        });

        expect(response.status).toBe(201);
        expect(conversationFindOne).not.toHaveBeenCalled();
        expect(conversationCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                isGroup: true,
                groupName: "Engineering Planning",
                admin: actorId,
                participants: [actorId, bobId, carolId],
                organizationId,
            })
        );
    });

    it("rejects an organization participant who is not a member", async () => {
        assertUsersAreOrgMembers.mockRejectedValue(
            new MockAuthorizationError("FORBIDDEN", "All participants must be organization members")
        );

        const beforeCreate = conversationCreate.mock.calls.length;
        const direct = await postConversation({
            participants: [actorId, danaId],
            isGroup: false,
        });
        expect(direct.status).toBe(403);
        expect(conversationCreate).toHaveBeenCalledTimes(beforeCreate);

        const group = await postConversation({
            participants: [actorId, bobId, danaId],
            isGroup: true,
            groupName: "Rejected",
            admin: actorId,
        });
        expect(group.status).toBe(403);
        expect(conversationCreate).not.toHaveBeenCalled();
    });
});
