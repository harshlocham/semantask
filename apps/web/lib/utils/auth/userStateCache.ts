import { Redis } from "@upstash/redis";
import { getUpstashRestConfig, upstashFailFastOptions } from "@/lib/config/redis";

export type CachedUserState = {
    id: string;
    email: string;
    role: "user" | "moderator" | "admin";
    tokenVersion: number;
    status?: string;
    isBanned?: boolean;
    isDeleted?: boolean;
    mustChangePassword?: boolean;
};

const DEFAULT_USER_STATE_CACHE_TTL_SECONDS = 45;
const USER_STATE_CACHE_KEY_PREFIX = "auth:user-state";

const upstash = getUpstashRestConfig();
const upstashUrl = upstash?.url;
const upstashToken = upstash?.token;

let redisClient: Redis | null = null;
if (upstashUrl && upstashToken) {
    redisClient = new Redis({
        url: upstashUrl,
        token: upstashToken,
        ...upstashFailFastOptions,
    });
}

function getUserStateCacheKey(userId: string): string {
    return `${USER_STATE_CACHE_KEY_PREFIX}:${userId}`;
}

export function getDefaultUserStateCacheTtlSeconds(): number {
    return DEFAULT_USER_STATE_CACHE_TTL_SECONDS;
}

export async function getCachedUserState(userId: string): Promise<CachedUserState | null> {
    if (!redisClient) return null;

    try {
        const raw = await redisClient.get<string>(getUserStateCacheKey(userId));
        if (!raw) return null;

        const parsed = JSON.parse(raw) as Partial<CachedUserState>;
        if (!parsed?.id || !parsed?.email || !parsed?.role || typeof parsed?.tokenVersion !== "number") {
            return null;
        }

        return {
            id: parsed.id,
            email: parsed.email,
            role: parsed.role,
            tokenVersion: parsed.tokenVersion,
            status: parsed.status,
            isBanned: parsed.isBanned,
            isDeleted: parsed.isDeleted,
            mustChangePassword: parsed.mustChangePassword === true,
        };
    } catch {
        return null;
    }
}

export async function setCachedUserState(
    state: CachedUserState,
    ttlSeconds = DEFAULT_USER_STATE_CACHE_TTL_SECONDS
): Promise<void> {
    if (!redisClient) return;

    try {
        await redisClient.set(getUserStateCacheKey(state.id), JSON.stringify(state), {
            ex: Math.max(1, ttlSeconds),
        });
    } catch {
        // Cache writes should never block auth.
    }
}

export async function clearCachedUserState(userId: string): Promise<void> {
    if (!redisClient) return;

    try {
        await redisClient.del(getUserStateCacheKey(userId));
    } catch {
        // Best effort cache invalidation.
    }
}
