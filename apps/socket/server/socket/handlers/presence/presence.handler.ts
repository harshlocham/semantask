// src/server/socket/handlers/presence/presence.handler.ts
import type { Redis } from "ioredis";
import type { Server as IOServer } from "socket.io";

import {
    ClientToServerEvents,
    ServerToClientEvents,
    SocketEvents,
} from "@semantask/types";
import {
    getActiveUsers,
    refreshPresence,
    trackSocketConnected,
    trackSocketDisconnected,
} from "../../services/presence.redis.service.js";
import {
    emitPresenceToUsers,
    getPresencePeers,
    intersectPresenceAudience,
} from "../../services/presence-peers.js";

type IO = IOServer<ClientToServerEvents, ServerToClientEvents>;
type Socket = import("socket.io").Socket<ClientToServerEvents, ServerToClientEvents>;

export function presenceHandler(_io: IO, socket: Socket, redis: Redis) {
    const userId = socket.data.userId;

    if (!userId) {
        console.warn("presenceHandler: missing userId");
        return;
    }

    void (async () => {
        try {
            await trackSocketConnected(redis, userId, socket.id);

            const [peers, activeUsers] = await Promise.all([
                getPresencePeers(redis, userId),
                getActiveUsers(redis),
            ]);

            const onlinePeers = intersectPresenceAudience(peers, activeUsers, userId);

            for (const activeUserId of onlinePeers) {
                socket.emit(SocketEvents.USER_ONLINE, { userId: activeUserId });
            }

            // Announce only to mutual-conversation peers who are currently online.
            emitPresenceToUsers(onlinePeers, SocketEvents.USER_ONLINE, { userId });
        } catch (error) {
            console.error("presence connect error", error);
        }
    })();

    socket.on(SocketEvents.PRESENCE_PING, async () => {
        try {
            await refreshPresence(redis, userId);
        } catch (error) {
            console.error("presence ping error", error);
        }
    });

    socket.on("disconnect", async () => {
        try {
            const { wentOffline } = await trackSocketDisconnected(redis, userId, socket.id);

            if (wentOffline) {
                const lastSeen = new Date();
                const peers = await getPresencePeers(redis, userId);
                emitPresenceToUsers(peers, SocketEvents.USER_OFFLINE, {
                    userId,
                    lastSeen,
                });
            }
        } catch (error) {
            console.error("presence disconnect error", error);
        }
    });
}
