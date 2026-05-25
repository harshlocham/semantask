import { cookies, headers } from "next/headers";
import mongoose from "mongoose";
import { authConfig, verifyAccessToken } from "@chat/auth";
import { connectToDatabase } from "@/lib/Db/db";
import { User } from "@/models/User";
import { ForbiddenError, UnauthorizedError } from "@/lib/utils/auth/authErrors";
import {
    CachedUserState,
    getCachedUserState,
    getDefaultUserStateCacheTtlSeconds,
    setCachedUserState,
} from "@/lib/utils/auth/userStateCache";

type AccessRole = "user" | "moderator" | "admin";

type AccessPayload = {
    sub: string;
    role?: AccessRole;
    tokenVersion: number;
    type: "access";
};

type DbUserRecord = {
    _id: { toString(): string };
    email: string;
    role?: AccessRole;
    status?: string;
    tokenVersion?: number;
    isBanned?: boolean;
    isDeleted?: boolean;
};

export type AuthenticatedUser = {
    id: string;
    email: string;
    role: AccessRole;
    tokenVersion: number;
};

export type ResolveAuthUserOptions = {
    useRedisCache?: boolean;
    cacheTtlSeconds?: number;
};

function normalizeRole(role: string | undefined): AccessRole {
    if (role === "admin" || role === "moderator") {
        return role;
    }
    return "user";
}

function isUserBanned(user: Pick<CachedUserState, "status" | "isBanned">): boolean {
    return user.isBanned === true || user.status === "banned";
}

function isUserDeleted(user: Pick<CachedUserState, "isDeleted">): boolean {
    return user.isDeleted === true;
}

function toCachedUserState(user: DbUserRecord): CachedUserState {
    return {
        id: user._id.toString(),
        email: user.email,
        role: normalizeRole(user.role),
        tokenVersion: user.tokenVersion || 0,
        status: user.status,
        isBanned: user.isBanned,
        isDeleted: user.isDeleted,
    };
}

async function loadUserStateFromDb(userId: string): Promise<CachedUserState | null> {
    await connectToDatabase();

    const user = await User.findById(userId)
        .select("_id email role status tokenVersion isBanned isDeleted")
        .lean<DbUserRecord | null>();

    if (!user) return null;
    return toCachedUserState(user);
}

async function resolveUserState(
    userId: string,
    options: ResolveAuthUserOptions = {}
): Promise<CachedUserState | null> {
    const useRedisCache = options.useRedisCache === true;

    if (useRedisCache) {
        const cached = await getCachedUserState(userId);
        if (cached) {
            return cached;
        }
    }

    const fromDb = await loadUserStateFromDb(userId);
    if (!fromDb) return null;

    if (useRedisCache) {
        await setCachedUserState(
            fromDb,
            options.cacheTtlSeconds || getDefaultUserStateCacheTtlSeconds()
        );
    }

    return fromDb;
}

function assertActiveUserState(
    user: CachedUserState,
    expectedTokenVersion?: number
): AuthenticatedUser {
    if (isUserDeleted(user)) {
        throw new ForbiddenError("User account has been deleted", "AUTH_USER_DELETED");
    }

    if (isUserBanned(user)) {
        throw new ForbiddenError("User account is banned", "AUTH_USER_BANNED");
    }

    if (
        expectedTokenVersion !== undefined &&
        user.tokenVersion !== expectedTokenVersion
    ) {
        throw new UnauthorizedError("Token has been revoked", "AUTH_TOKEN_REVOKED");
    }

    return {
        id: user.id,
        email: user.email,
        role: normalizeRole(user.role),
        tokenVersion: user.tokenVersion,
    };
}

function getAccessTokenFromCookieStore(cookieStore: Awaited<ReturnType<typeof cookies>>): string {
    const token = cookieStore.get(authConfig.cookie.accessToken)?.value;
    return token || "";
}

async function getAccessTokenFromAuthorizationHeader(): Promise<string> {
    const requestHeaders = await headers();
    const authorization = requestHeaders.get("authorization") || requestHeaders.get("Authorization");

    if (!authorization) return "";

    const [scheme, token] = authorization.split(" ");
    if (!scheme || !token) return "";
    if (scheme.toLowerCase() !== "bearer") return "";

    return token.trim();
}

async function resolveAccessToken(): Promise<string> {
    const cookieStore = await cookies();
    const cookieToken = getAccessTokenFromCookieStore(cookieStore);
    if (cookieToken) return cookieToken;

    const headerToken = await getAccessTokenFromAuthorizationHeader();
    if (headerToken) return headerToken;

    throw new UnauthorizedError("Access token is missing", "AUTH_ACCESS_TOKEN_MISSING");
}

export async function validateAuthUser(
    options: ResolveAuthUserOptions = {}
): Promise<AuthenticatedUser> {
    const accessToken = await resolveAccessToken();

    let payload: AccessPayload;
    try {
        payload = verifyAccessToken(accessToken) as AccessPayload;
    } catch {
        throw new UnauthorizedError("Access token is invalid", "AUTH_ACCESS_TOKEN_INVALID");
    }

    if (!payload?.sub || !mongoose.Types.ObjectId.isValid(payload.sub)) {
        throw new UnauthorizedError("Access token is invalid", "AUTH_ACCESS_TOKEN_INVALID");
    }

    const user = await resolveUserState(payload.sub, options);
    if (!user) {
        throw new UnauthorizedError("User not found", "AUTH_USER_NOT_FOUND");
    }

    return assertActiveUserState(user, payload.tokenVersion);
}

type ResolveUserByIdInput = {
    userId: string;
    tokenVersion?: number;
    options?: ResolveAuthUserOptions;
};

export async function validateAuthUserById(
    input: ResolveUserByIdInput
): Promise<AuthenticatedUser> {
    const { userId, tokenVersion, options } = input;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        throw new UnauthorizedError("User identifier is invalid", "AUTH_UNAUTHORIZED");
    }

    const user = await resolveUserState(userId, options);
    if (!user) {
        throw new UnauthorizedError("User not found", "AUTH_USER_NOT_FOUND");
    }

    return assertActiveUserState(user, tokenVersion);
}
