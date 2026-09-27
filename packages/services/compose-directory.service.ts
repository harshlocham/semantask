import type { UserRef } from "@semantask/types";
import { connectToDatabase } from "@semantask/db";
import { Conversation } from "@semantask/db/models/Conversation";
import OrganizationMembershipModel from "@semantask/db/models/OrganizationMembership";
import { User } from "@semantask/db/models/User";
import { Types } from "mongoose";
import { AuthorizationError } from "./authorization-errors";
import { ValidationError } from "./organization-errors";
import { assertMembership, canManageMembers } from "./organization.service";

/**
 * Workspace-scoped participant discovery for the new-conversation composer.
 *
 * Answers "who can this user start a conversation with from this workspace?"
 * It does not list the platform user table.
 *
 * Indexes already on the collections (none added for this query):
 * - OrganizationMembership { organizationId, userId } unique
 * - OrganizationMembership { userId, organizationId }
 * - User { email } unique
 * - Conversation { organizationId, participants }
 * - Conversation { organizationId, updatedAt }
 *
 * Organization search loads member ids from the membership index, then
 * User.find({ _id: { $in }, prefix }).limit(page). That is membership
 * intersected with the user predicate. A username index is not the access
 * path: the prefix is a residual filter on a bounded _id set.
 *
 * Personal suggestions read the caller's recent personal conversations
 * (limit COMPOSE_CONVERSATION_SCAN) and resolve only those other participants.
 * Personal search adds co-members of the caller's organizations. An exact
 * email that is outside that set is not returned.
 *
 * Page size is clamped to COMPOSE_PAGE_MAX. The cursor is a user id.
 */
export const COMPOSE_PAGE_MAX = 20;
export const COMPOSE_CONVERSATION_SCAN = 20;
const COMPOSE_RELATION_CAP = 100;
const QUERY_MAX = 80;

const SAFE_USER_SELECT = { username: 1, email: 1, profilePicture: 1 } as const;
const EXACT_USER_SELECT = {
    username: 1,
    email: 1,
    profilePicture: 1,
    status: 1,
    isDeleted: 1,
} as const;

const ACTIVE_USER = {
    status: { $ne: "banned" },
    isDeleted: { $ne: true },
} as const;

export type ComposeParticipant = UserRef & {
    existingDirectConversationId: string | null;
};

export type ComposeDirectoryResult = {
    suggestions: ComposeParticipant[];
    results: ComposeParticipant[];
    nextCursor: string | null;
    invite: { email: string } | null;
};

export type ComposeDirectoryInput = {
    actorUserId: string;
    organizationId: string | null;
    query?: string | null;
    limit?: number;
    cursor?: string | null;
};

type UserRow = {
    _id: Types.ObjectId;
    username: string;
    email?: string;
    profilePicture?: string | null;
    status?: string;
    isDeleted?: boolean;
};

type ConversationRow = {
    _id: Types.ObjectId;
    participants?: unknown[];
};

export function clampComposeLimit(limit: number | undefined): number {
    if (limit == null || !Number.isFinite(limit)) return COMPOSE_PAGE_MAX;
    const whole = Math.floor(limit);
    if (whole < 1) return 1;
    return Math.min(whole, COMPOSE_PAGE_MAX);
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isExactEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function asId(value: unknown): string | null {
    if (!value) return null;
    if (typeof value === "string") {
        return Types.ObjectId.isValid(value) ? value : null;
    }
    if (value instanceof Types.ObjectId) return value.toString();
    if (typeof value === "object" && value !== null && "_id" in value) {
        return asId((value as { _id: unknown })._id);
    }
    return null;
}

function parseCursor(cursor: string | null | undefined): string | null {
    if (!cursor?.trim()) return null;
    const value = cursor.trim();
    if (!Types.ObjectId.isValid(value)) {
        throw new ValidationError("Invalid cursor");
    }
    return value;
}

function workspaceClause(organizationId: string | null): Record<string, unknown> {
    if (organizationId) {
        return { organizationId: new Types.ObjectId(organizationId) };
    }
    return {
        $or: [
            { organizationId: null },
            { organizationId: { $exists: false } },
        ],
    };
}

function prefixClauses(query: string): Array<Record<string, RegExp>> {
    const pattern = new RegExp(`^${escapeRegex(query)}`, "i");
    return [{ username: pattern }, { email: pattern }];
}

function isInactive(user: UserRow): boolean {
    return user.status === "banned" || user.isDeleted === true;
}

function pack(
    people: ComposeParticipant[],
    mode: "suggestions" | "results",
    nextCursor: string | null,
    invite: { email: string } | null
): ComposeDirectoryResult {
    return {
        suggestions: mode === "suggestions" ? people : [],
        results: mode === "results" ? people : [],
        nextCursor,
        invite,
    };
}

function pageOrderedIds(
    ordered: string[],
    cursor: string | null,
    limit: number
): { ids: string[]; nextCursor: string | null } {
    let start = 0;
    if (cursor) {
        const index = ordered.indexOf(cursor);
        start = index === -1 ? ordered.length : index + 1;
    }
    const ids = ordered.slice(start, start + limit);
    const nextCursor = start + limit < ordered.length ? (ids[ids.length - 1] ?? null) : null;
    return { ids, nextCursor };
}

function toParticipant(user: UserRow, directIds: Map<string, string>): ComposeParticipant {
    const id = String(user._id);
    return {
        id,
        username: user.username,
        email: user.email,
        profilePicture: user.profilePicture ?? null,
        existingDirectConversationId: directIds.get(id) ?? null,
    };
}

async function loadRecentParticipantIds(
    actorUserId: string,
    organizationId: string | null
): Promise<string[]> {
    const conversations = await Conversation.find({
        participants: new Types.ObjectId(actorUserId),
        ...workspaceClause(organizationId),
    })
        .sort({ updatedAt: -1 })
        .limit(COMPOSE_CONVERSATION_SCAN)
        .select({ participants: 1 })
        .lean<ConversationRow[]>();

    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const conversation of conversations) {
        for (const participant of conversation.participants ?? []) {
            const id = asId(participant);
            if (!id || id === actorUserId || seen.has(id)) continue;
            seen.add(id);
            ordered.push(id);
            if (ordered.length >= COMPOSE_RELATION_CAP) return ordered;
        }
    }
    return ordered;
}

async function keepOrganizationMembers(
    organizationId: string,
    userIds: string[]
): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await OrganizationMembershipModel.find({
        organizationId: new Types.ObjectId(organizationId),
        userId: { $in: userIds.map((id) => new Types.ObjectId(id)) },
    })
        .select({ userId: 1 })
        .lean<Array<{ userId: Types.ObjectId }>>();
    const allowed = new Set(rows.map((row) => String(row.userId)));
    return userIds.filter((id) => allowed.has(id));
}

async function listOrganizationMemberIds(
    organizationId: string,
    actorUserId: string
): Promise<Types.ObjectId[]> {
    const rows = await OrganizationMembershipModel.find({
        organizationId: new Types.ObjectId(organizationId),
        userId: { $ne: new Types.ObjectId(actorUserId) },
    })
        .select({ userId: 1 })
        .lean<Array<{ userId: Types.ObjectId }>>();
    return rows.map((row) => row.userId);
}

async function listCoMemberIds(actorUserId: string): Promise<string[]> {
    const memberships = await OrganizationMembershipModel.find({
        userId: new Types.ObjectId(actorUserId),
    })
        .select({ organizationId: 1 })
        .lean<Array<{ organizationId: Types.ObjectId }>>();
    const organizationIds = memberships.map((row) => row.organizationId);
    if (organizationIds.length === 0) return [];

    const rows = await OrganizationMembershipModel.find({
        organizationId: { $in: organizationIds },
        userId: { $ne: new Types.ObjectId(actorUserId) },
    })
        .select({ userId: 1 })
        .lean<Array<{ userId: Types.ObjectId }>>();
    return rows.map((row) => String(row.userId));
}

async function sharesOrganization(actorUserId: string, otherUserId: string): Promise<boolean> {
    const memberships = await OrganizationMembershipModel.find({
        userId: new Types.ObjectId(actorUserId),
    })
        .select({ organizationId: 1 })
        .lean<Array<{ organizationId: Types.ObjectId }>>();
    if (memberships.length === 0) return false;

    const hit = await OrganizationMembershipModel.findOne({
        userId: new Types.ObjectId(otherUserId),
        organizationId: { $in: memberships.map((row) => row.organizationId) },
    }).lean<{ _id: Types.ObjectId } | null>();
    return Boolean(hit);
}

async function sharesPersonalConversation(
    actorUserId: string,
    otherUserId: string
): Promise<boolean> {
    const row = await Conversation.findOne({
        participants: {
            $all: [new Types.ObjectId(actorUserId), new Types.ObjectId(otherUserId)],
        },
        ...workspaceClause(null),
    })
        .select({ _id: 1 })
        .lean<{ _id: Types.ObjectId } | null>();
    return Boolean(row);
}

async function findActiveUsers(input: {
    ids: Types.ObjectId[];
    query: string | null;
    cursor: string | null;
    limit: number;
}): Promise<UserRow[]> {
    if (input.ids.length === 0) return [];
    const idClause = input.cursor
        ? { $in: input.ids, $gt: new Types.ObjectId(input.cursor) }
        : { $in: input.ids };
    return User.find({
        _id: idClause,
        ...ACTIVE_USER,
        ...(input.query ? { $or: prefixClauses(input.query) } : {}),
    })
        .select(SAFE_USER_SELECT)
        .sort({ _id: 1 })
        .limit(input.limit + 1)
        .lean<UserRow[]>();
}

async function findUsersByIds(ids: string[]): Promise<UserRow[]> {
    if (ids.length === 0) return [];
    const rows = await User.find({
        _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
        ...ACTIVE_USER,
    })
        .select(SAFE_USER_SELECT)
        .lean<UserRow[]>();
    const byId = new Map(rows.map((row) => [String(row._id), row]));
    return ids
        .map((id) => byId.get(id))
        .filter((row): row is UserRow => Boolean(row));
}

async function loadDirectConversationIds(
    actorUserId: string,
    organizationId: string | null,
    participantIds: string[]
): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (participantIds.length === 0) return map;

    const rows = await Conversation.find({
        isGroup: false,
        ...workspaceClause(organizationId),
        $and: [
            { participants: new Types.ObjectId(actorUserId) },
            { participants: { $in: participantIds.map((id) => new Types.ObjectId(id)) } },
        ],
    })
        .select({ participants: 1 })
        .lean<ConversationRow[]>();

    const wanted = new Set(participantIds);
    for (const row of rows) {
        const ids = (row.participants ?? [])
            .map(asId)
            .filter((id): id is string => Boolean(id));
        if (ids.length !== 2 || !ids.includes(actorUserId)) continue;
        const other = ids.find((id) => id !== actorUserId);
        if (!other || !wanted.has(other) || map.has(other)) continue;
        map.set(other, String(row._id));
    }
    return map;
}

async function withDirectConversations(
    actorUserId: string,
    organizationId: string | null,
    users: UserRow[]
): Promise<ComposeParticipant[]> {
    const directIds = await loadDirectConversationIds(
        actorUserId,
        organizationId,
        users.map((user) => String(user._id))
    );
    return users.map((user) => toParticipant(user, directIds));
}

export async function composeDirectory(
    input: ComposeDirectoryInput
): Promise<ComposeDirectoryResult> {
    if (!Types.ObjectId.isValid(input.actorUserId)) {
        throw new AuthorizationError("FORBIDDEN", "Invalid user");
    }
    if (input.organizationId && !Types.ObjectId.isValid(input.organizationId)) {
        throw new AuthorizationError("FORBIDDEN", "Invalid organization context");
    }

    await connectToDatabase();

    let callerCanInvite = !input.organizationId;
    if (input.organizationId) {
        const membership = await assertMembership(input.organizationId, input.actorUserId);
        callerCanInvite = canManageMembers(membership.role);
    }

    const limit = clampComposeLimit(input.limit);
    const cursor = parseCursor(input.cursor);
    const query = (input.query ?? "").trim().slice(0, QUERY_MAX);

    if (!query) {
        let ordered = await loadRecentParticipantIds(input.actorUserId, input.organizationId);
        if (input.organizationId) {
            ordered = await keepOrganizationMembers(input.organizationId, ordered);
        }
        const page = pageOrderedIds(ordered, cursor, limit);
        const users = await findUsersByIds(page.ids);
        const suggestions = await withDirectConversations(
            input.actorUserId,
            input.organizationId,
            users
        );
        return pack(suggestions, "suggestions", page.nextCursor, null);
    }

    if (isExactEmail(query)) {
        const email = query.toLowerCase();
        const user = await User.findOne({ email })
            .select(EXACT_USER_SELECT)
            .lean<UserRow | null>();

        const invite = callerCanInvite ? { email } : null;
        if (!user || String(user._id) === input.actorUserId || isInactive(user)) {
            return pack([], "results", null, user ? null : invite);
        }

        const userId = String(user._id);
        const eligible = input.organizationId
            ? Boolean(
                await OrganizationMembershipModel.findOne({
                    organizationId: new Types.ObjectId(input.organizationId),
                    userId: user._id,
                }).lean<{ _id: Types.ObjectId } | null>()
            )
            : (await sharesOrganization(input.actorUserId, userId))
                || (await sharesPersonalConversation(input.actorUserId, userId));

        if (!eligible || cursor) {
            return pack([], "results", null, eligible ? null : invite);
        }

        const results = await withDirectConversations(
            input.actorUserId,
            input.organizationId,
            [user]
        );
        return pack(results, "results", null, null);
    }

    const ids = input.organizationId
        ? await listOrganizationMemberIds(input.organizationId, input.actorUserId)
        : (await listCoMemberIds(input.actorUserId))
            .concat(await loadRecentParticipantIds(input.actorUserId, null))
            .filter((id, index, all) => id !== input.actorUserId && all.indexOf(id) === index)
            .map((id) => new Types.ObjectId(id));

    const rows = await findActiveUsers({
        ids,
        query,
        cursor,
        limit,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const allowed = new Set(ids.map((id) => String(id)));
    const visible = page.filter(
        (row) => allowed.has(String(row._id)) && String(row._id) !== input.actorUserId
    );
    const nextCursor = hasMore && page.length > 0 ? String(page[page.length - 1]?._id) : null;
    const results = await withDirectConversations(
        input.actorUserId,
        input.organizationId,
        visible
    );
    return pack(results, "results", nextCursor, null);
}
