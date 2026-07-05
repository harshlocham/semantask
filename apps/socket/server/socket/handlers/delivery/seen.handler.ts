// src/server/socket/handlers/delivery/seen.handler.ts
import type { Redis } from "ioredis";
import { Socket, Server } from "socket.io";
import { SocketEvents } from "@semantask/types";
import { setMessageDeliveryState } from "../../services/presence.redis.service.js";

export const SeenHandler = (io: Server, socket: Socket, redis: Redis) => {
    socket.on(SocketEvents.MESSAGE_SEEN, async (payload: { conversationId: string; messageIds: string[] }) => {
        const { conversationId, messageIds } = payload;
        if (!conversationId || !Array.isArray(messageIds) || messageIds.length === 0) {
            return;
        }

        const seenAt = new Date();
        const userId = socket.data.userId;

        for (const messageId of messageIds) {
            await setMessageDeliveryState(redis, messageId, "seen");
        }

        io.to(`conversation:${conversationId}`).emit(SocketEvents.MESSAGE_SEEN_UPDATE, {
            conversationId,
            messageIds,
            userId,
            seenAt,
        });
    });
};
