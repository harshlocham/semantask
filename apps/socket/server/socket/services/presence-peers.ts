import type { Redis } from "ioredis";
import { emitToUser } from "../emit.js";
import { PRESENCE_PEERS_CACHE_TTL_SECONDS, redisKeys } from "../keys.js";
import { postToInternalWebApi } from "./internal-web-bridge.js";

type PresencePeersResponse = {
    peerIds?: string[];
};

/**
 * Online peers that share at least one conversation with `userId`
 * (excluding self). Used for hydrate + announce fan-out.
 */
export function intersectPresenceAudience(
    peerIds: string[],
    activeUserIds: string[],
    excludeUserId?: string
): string[] {
    const active = new Set(activeUserIds);
    return peerIds.filter(
        (peerId) => active.has(peerId) && peerId !== excludeUserId
    );
}

export async function getPresencePeers(redis: Redis, userId: string): Promise<string[]> {
    const cacheKey = redisKeys.presencePeers(userId);

    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            const parsed = JSON.parse(cached) as unknown;
            if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string")) {
                return parsed;
            }
        }
    } catch {
        // Cache miss / corrupt entry — fall through to web bridge.
    }

    const response = await postToInternalWebApi<PresencePeersResponse>({
        path: "/api/internal/socket/presence-peers",
        body: { userId },
        timeoutMs: 5_000,
    });

    const peerIds = Array.isArray(response?.peerIds)
        ? response.peerIds.filter((id): id is string => typeof id === "string" && id.length > 0)
        : [];

    try {
        await redis.set(
            cacheKey,
            JSON.stringify(peerIds),
            "EX",
            PRESENCE_PEERS_CACHE_TTL_SECONDS
        );
    } catch {
        // Best-effort cache write.
    }

    return peerIds;
}

export function emitPresenceToUsers(
    userIds: string[],
    event: string,
    payload: unknown
): void {
    for (const userId of userIds) {
        emitToUser(userId, event, payload);
    }
}
