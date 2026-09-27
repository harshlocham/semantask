jest.mock("@semantask/db", () => ({
    connectToDatabase: jest.fn().mockResolvedValue(undefined),
}));

const membershipFind = jest.fn();
const membershipFindOne = jest.fn();
const userFind = jest.fn();
const userFindOne = jest.fn();
const conversationFind = jest.fn();
const conversationFindOne = jest.fn();

jest.mock("@semantask/db/models/OrganizationMembership", () => ({
    __esModule: true,
    default: {
        find: (...args: unknown[]) => membershipFind(...args),
        findOne: (...args: unknown[]) => membershipFindOne(...args),
    },
}));

jest.mock("@semantask/db/models/User", () => ({
    User: {
        find: (...args: unknown[]) => userFind(...args),
        findOne: (...args: unknown[]) => userFindOne(...args),
    },
}));

jest.mock("@semantask/db/models/Conversation", () => ({
    Conversation: {
        find: (...args: unknown[]) => conversationFind(...args),
        findOne: (...args: unknown[]) => conversationFindOne(...args),
    },
}));

import { Types } from "mongoose";
import { beforeEach, describe, expect, it } from "@jest/globals";
import { AuthorizationError } from "../authorization-errors";
import {
    COMPOSE_CONVERSATION_SCAN,
    COMPOSE_PAGE_MAX,
    composeDirectory,
} from "../compose-directory.service";
import { ValidationError } from "../organization-errors";

const actorId = "507f1f77bcf86cd799439011";
const bobId = "507f1f77bcf86cd799439012";
const carolId = "507f1f77bcf86cd799439013";
const danaId = "507f1f77bcf86cd799439014";
const orgId = "507f1f77bcf86cd799439015";
const dmId = "507f1f77bcf86cd799439016";

type QueryChain<T> = {
    select: jest.Mock;
    sort: jest.Mock;
    limit: jest.Mock;
    lean: jest.Mock<Promise<T>>;
};

function chain<T>(rows: T): QueryChain<T> {
    const api = {} as QueryChain<T>;
    api.select = jest.fn(() => api);
    api.sort = jest.fn(() => api);
    api.limit = jest.fn(() => api);
    api.lean = jest.fn(async () => rows);
    return api;
}

function selectLean<T>(value: T) {
    const lean = jest.fn(async () => value);
    const select = jest.fn((_fields?: unknown) => ({ lean }));
    return { select, lean };
}

function leanOf<T>(value: T) {
    return { lean: jest.fn(async () => value) };
}

function userRow(id: string, username: string, extra: Record<string, unknown> = {}) {
    return {
        _id: new Types.ObjectId(id),
        username,
        email: `${username.toLowerCase()}@example.com`,
        profilePicture: null,
        password: "hashed-password",
        tokenVersion: 4,
        twoFactorSecret: "totp-secret",
        status: "active",
        isDeleted: false,
        ...extra,
    };
}

function idList(value: unknown): string[] {
    if (!value || typeof value !== "object" || !("$in" in value)) return [];
    const list = (value as { $in?: unknown[] }).$in ?? [];
    return list.map((id) => String(id));
}

describe("composeDirectory", () => {
    beforeEach(() => {
        membershipFind.mockReset();
        membershipFindOne.mockReset();
        userFind.mockReset();
        userFindOne.mockReset();
        conversationFind.mockReset();
        conversationFindOne.mockReset();

        membershipFind.mockReturnValue(chain([]));
        membershipFindOne.mockReturnValue(leanOf({ role: "member" }));
        userFind.mockReturnValue(chain([]));
        userFindOne.mockReturnValue(selectLean(null));
        conversationFind.mockReturnValue(chain([]));
        conversationFindOne.mockReturnValue(selectLean(null));
    });

    it("rejects a caller who is not a member of the active organization", async () => {
        membershipFindOne.mockReturnValue(leanOf(null));

        await expect(
            composeDirectory({
                actorUserId: actorId,
                organizationId: orgId,
                query: "bob",
            })
        ).rejects.toBeInstanceOf(AuthorizationError);
        expect(userFind).not.toHaveBeenCalled();
        expect(userFindOne).not.toHaveBeenCalled();
    });

    it("searches only organization member ids and drops anyone outside that set", async () => {
        membershipFind.mockReturnValue(
            chain([
                { userId: new Types.ObjectId(bobId) },
                { userId: new Types.ObjectId(carolId) },
            ])
        );
        userFind.mockReturnValue(
            chain([
                userRow(bobId, "Bob"),
                userRow(carolId, "Carol"),
                userRow(danaId, "Dana"),
                userRow(actorId, "Ada"),
            ])
        );

        const result = await composeDirectory({
            actorUserId: actorId,
            organizationId: orgId,
            query: "bo",
        });

        const memberFilter = membershipFind.mock.calls[0]?.[0] as {
            userId: { $ne: Types.ObjectId };
        };
        expect(String(memberFilter.userId.$ne)).toBe(actorId);
        const userFilter = userFind.mock.calls[0]?.[0] as { _id: { $in: Types.ObjectId[] } };
        expect(idList(userFilter._id)).toEqual([bobId, carolId]);
        expect(userFilter).not.toEqual({});
        expect(result.results.map((person) => person.id)).toEqual([bobId, carolId]);
        expect(result.suggestions).toEqual([]);
    });

    it("does not return an exact-email user who is not an organization member", async () => {
        membershipFindOne.mockImplementation((filter: { userId?: Types.ObjectId }) => {
            if (String(filter.userId) === actorId) return leanOf({ role: "member" });
            return leanOf(null);
        });
        userFindOne.mockReturnValue(
            selectLean(userRow(danaId, "Dana", { email: "dana@example.com" }))
        );

        const result = await composeDirectory({
            actorUserId: actorId,
            organizationId: orgId,
            query: "dana@example.com",
        });

        expect(result.results).toEqual([]);
        expect(result.invite).toBeNull();
        expect(userFind).not.toHaveBeenCalled();
    });

    it("offers an organization invite only when the caller can manage members", async () => {
        membershipFindOne.mockReturnValue(leanOf({ role: "owner" }));
        userFindOne.mockReturnValue(selectLean(null));

        const result = await composeDirectory({
            actorUserId: actorId,
            organizationId: orgId,
            query: "new.person@example.com",
        });

        expect(result.results).toEqual([]);
        expect(result.invite).toEqual({ email: "new.person@example.com" });
    });

    it("excludes the current user from organization search results", async () => {
        membershipFind.mockReturnValue(chain([{ userId: new Types.ObjectId(bobId) }]));
        userFind.mockReturnValue(chain([userRow(actorId, "Ada"), userRow(bobId, "Bob")]));

        const result = await composeDirectory({
            actorUserId: actorId,
            organizationId: orgId,
            query: "a",
        });

        expect(result.results.map((person) => person.id)).toEqual([bobId]);
    });

    it("clamps the page size and returns a cursor", async () => {
        const ids = Array.from({ length: 25 }, () => new Types.ObjectId().toString());
        membershipFind.mockReturnValue(
            chain(ids.map((id) => ({ userId: new Types.ObjectId(id) })))
        );
        const userChain = chain(ids.map((id, index) => userRow(id, `Member${index}`)));
        userFind.mockReturnValue(userChain);

        const result = await composeDirectory({
            actorUserId: actorId,
            organizationId: orgId,
            query: "Member",
            limit: 100,
        });

        expect(COMPOSE_PAGE_MAX).toBe(20);
        expect(userChain.limit).toHaveBeenCalledWith(COMPOSE_PAGE_MAX + 1);
        expect(result.results).toHaveLength(COMPOSE_PAGE_MAX);
        expect(result.nextCursor).toBe(ids[COMPOSE_PAGE_MAX - 1]);
    });

    it("pages organization search with a user-id cursor", async () => {
        const ids = [bobId, carolId, danaId];
        membershipFind.mockReturnValue(
            chain(ids.map((id) => ({ userId: new Types.ObjectId(id) })))
        );
        userFind.mockImplementation((filter: { _id: { $gt?: Types.ObjectId } }) => {
            if (filter._id.$gt) {
                return chain([userRow(danaId, "Dana")]);
            }
            return chain([
                userRow(bobId, "Bob"),
                userRow(carolId, "Carol"),
                userRow(danaId, "Dana"),
            ]);
        });

        const first = await composeDirectory({
            actorUserId: actorId,
            organizationId: orgId,
            query: "a",
            limit: 2,
        });
        expect(first.results.map((person) => person.id)).toEqual([bobId, carolId]);
        expect(first.nextCursor).toBe(carolId);

        const second = await composeDirectory({
            actorUserId: actorId,
            organizationId: orgId,
            query: "a",
            limit: 2,
            cursor: first.nextCursor,
        });
        const secondFilter = userFind.mock.calls[1]?.[0] as { _id: { $gt: Types.ObjectId } };
        expect(String(secondFilter._id.$gt)).toBe(carolId);
        expect(second.results.map((person) => person.id)).toEqual([danaId]);
        expect(second.nextCursor).toBeNull();
    });

    it("bounds personal suggestions to recent conversations", async () => {
        const recent = chain([
            {
                _id: new Types.ObjectId(),
                participants: [new Types.ObjectId(actorId), new Types.ObjectId(bobId)],
            },
        ]);
        conversationFind.mockImplementation((filter: { isGroup?: boolean }) => {
            if (filter.isGroup === false) return chain([]);
            return recent;
        });
        userFind.mockReturnValue(chain([userRow(bobId, "Bob")]));

        const result = await composeDirectory({
            actorUserId: actorId,
            organizationId: null,
        });

        expect(recent.limit).toHaveBeenCalledWith(COMPOSE_CONVERSATION_SCAN);
        const conversationFilter = conversationFind.mock.calls[0]?.[0] as {
            $or: unknown;
        };
        expect(conversationFilter.$or).toEqual([
            { organizationId: null },
            { organizationId: { $exists: false } },
        ]);
        const userFilter = userFind.mock.calls[0]?.[0] as { _id: { $in: Types.ObjectId[] } };
        expect(idList(userFilter._id)).toEqual([bobId]);
        expect(result.suggestions.map((person) => person.id)).toEqual([bobId]);
        expect(result.results).toEqual([]);
    });

    it("does not return an unrelated account from personal exact-email lookup", async () => {
        userFindOne.mockReturnValue(
            selectLean(userRow(danaId, "Dana", { email: "dana@example.com" }))
        );

        const result = await composeDirectory({
            actorUserId: actorId,
            organizationId: null,
            query: "dana@example.com",
        });

        expect(result.results).toEqual([]);
        expect(result.invite).toEqual({ email: "dana@example.com" });
        expect(userFind).not.toHaveBeenCalled();
    });

    it("returns a shared-organization person from a personal exact-email lookup", async () => {
        userFindOne.mockReturnValue(
            selectLean(userRow(carolId, "Carol", { email: "carol@example.com" }))
        );
        membershipFind.mockReturnValue(
            chain([{ organizationId: new Types.ObjectId(orgId) }])
        );
        membershipFindOne.mockReturnValue(leanOf({ _id: new Types.ObjectId() }));

        const result = await composeDirectory({
            actorUserId: actorId,
            organizationId: null,
            query: "carol@example.com",
        });

        expect(result.results.map((person) => person.username)).toEqual(["Carol"]);
        expect(userFind).not.toHaveBeenCalled();
    });

    it("does not query users at all when a personal prefix has no eligible ids", async () => {
        const result = await composeDirectory({
            actorUserId: actorId,
            organizationId: null,
            query: "zzz",
        });

        expect(result.results).toEqual([]);
        expect(userFind).not.toHaveBeenCalled();
        expect(userFindOne).not.toHaveBeenCalled();
    });

    it("returns only safe participant fields and selects those columns", async () => {
        membershipFind.mockReturnValue(chain([{ userId: new Types.ObjectId(bobId) }]));
        const userChain = chain([userRow(bobId, "Bob")]);
        userFind.mockReturnValue(userChain);

        const result = await composeDirectory({
            actorUserId: actorId,
            organizationId: orgId,
            query: "Bo",
        });

        expect(userChain.select).toHaveBeenCalledWith({
            username: 1,
            email: 1,
            profilePicture: 1,
        });
        expect(result.results[0]).toEqual({
            id: bobId,
            username: "Bob",
            email: "bob@example.com",
            profilePicture: null,
            existingDirectConversationId: null,
        });
        expect(result.results[0]).not.toHaveProperty("password");
        expect(result.results[0]).not.toHaveProperty("tokenVersion");
        expect(result.results[0]).not.toHaveProperty("twoFactorSecret");
    });

    it("selects safe columns for an exact email lookup", async () => {
        const lookup = selectLean(userRow(bobId, "Bob", { email: "bob@example.com" }));
        userFindOne.mockReturnValue(lookup);
        membershipFindOne.mockImplementation((filter: { userId?: Types.ObjectId }) => {
            if (String(filter.userId) === actorId) return leanOf({ role: "member" });
            return leanOf({ _id: new Types.ObjectId() });
        });

        const result = await composeDirectory({
            actorUserId: actorId,
            organizationId: orgId,
            query: "bob@example.com",
        });

        expect(lookup.select).toHaveBeenCalledWith({
            username: 1,
            email: 1,
            profilePicture: 1,
            status: 1,
            isDeleted: 1,
        });
        expect(result.results[0]).not.toHaveProperty("password");
        expect(result.results[0]?.id).toBe(bobId);
    });

    it("attaches an existing direct conversation id in the same workspace", async () => {
        conversationFind.mockImplementation((filter: { isGroup?: boolean }) => {
            if (filter.isGroup === false) {
                return chain([
                    {
                        _id: new Types.ObjectId(dmId),
                        participants: [
                            new Types.ObjectId(actorId),
                            new Types.ObjectId(bobId),
                        ],
                    },
                ]);
            }
            return chain([
                {
                    _id: new Types.ObjectId(),
                    participants: [
                        new Types.ObjectId(actorId),
                        new Types.ObjectId(bobId),
                    ],
                },
            ]);
        });
        userFind.mockReturnValue(chain([userRow(bobId, "Bob")]));

        const result = await composeDirectory({
            actorUserId: actorId,
            organizationId: null,
        });

        expect(result.suggestions[0]?.existingDirectConversationId).toBe(dmId);
    });

    it("omits non-members from organization suggestions", async () => {
        conversationFind.mockImplementation((filter: { isGroup?: boolean }) => {
            if (filter.isGroup === false) return chain([]);
            return chain([
                {
                    _id: new Types.ObjectId(),
                    participants: [
                        new Types.ObjectId(actorId),
                        new Types.ObjectId(bobId),
                        new Types.ObjectId(danaId),
                    ],
                },
            ]);
        });
        membershipFind.mockReturnValue(chain([{ userId: new Types.ObjectId(bobId) }]));
        userFind.mockReturnValue(chain([userRow(bobId, "Bob"), userRow(danaId, "Dana")]));

        const result = await composeDirectory({
            actorUserId: actorId,
            organizationId: orgId,
        });

        expect(result.suggestions.map((person) => person.id)).toEqual([bobId]);
    });

    it("rejects an invalid cursor", async () => {
        await expect(
            composeDirectory({
                actorUserId: actorId,
                organizationId: null,
                cursor: "not-a-cursor",
            })
        ).rejects.toBeInstanceOf(ValidationError);
        expect(conversationFind).not.toHaveBeenCalled();
    });
});
