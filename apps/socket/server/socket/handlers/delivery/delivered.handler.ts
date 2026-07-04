// src/server/socket/handlers/delivery/delivered.handler.ts
import type { Server as IOServer } from "socket.io";
import type { Redis } from "ioredis";
import {
    type ServerToClientEvents,
    type ClientToServerEvents,
    SocketEvents,
} from "@semantask/types";
import {
    getMessageDeliveryState,
    setMessageDeliveryState,
} from "../../services/presence.redis.service.js";

type IO = IOServer<ClientToServerEvents, ServerToClientEvents>;
type Socket = import("socket.io").Socket<
    ClientToServerEvents,
    ServerToClientEvents
>;

export function deliveredHandler(io: IO, socket: Socket, redis: Redis) {
    socket.on(SocketEvents.MESSAGE_DELIVERED, async ({ messageId, conversationId, at, senderId }) => {
        if (!messageId || !conversationId) return;

        const deliveredAt = at ? new Date(at) : new Date();
        const userId = socket.data.userId;

        const currentState = await getMessageDeliveryState(redis, messageId);
        if (currentState !== "seen") {
            await setMessageDeliveryState(redis, messageId, "delivered");
        }

        const payload = { messageId, conversationId, userId, deliveredAt };

        if (senderId) {
            io.to(`user:${senderId}`).emit(SocketEvents.MESSAGE_DELIVERED_UPDATE, payload);
            return;
        }

        io.to(`conversation:${conversationId}`).emit(SocketEvents.MESSAGE_DELIVERED_UPDATE, payload);
    });
}