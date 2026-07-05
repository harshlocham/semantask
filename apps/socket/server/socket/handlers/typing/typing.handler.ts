// src/server/socket/handlers/typing/typing.handler.ts
import type { Server as IOServer } from "socket.io";
import {
    ServerToClientEvents,
    ClientToServerEvents,
    //TypingStartPayload,
    // TypingStopPayload,
    SocketEvents,
} from "@semantask/types";

type IO = IOServer<ClientToServerEvents, ServerToClientEvents>;
type Socket = import("socket.io").Socket<
    ClientToServerEvents,
    ServerToClientEvents
>;

type TypingEventPayload = {
    conversationId: string;
    conversationMembers?: string[];
};

export function typingHandler(io: IO, socket: Socket) {
    const relayTypingEvent = (
        eventName: typeof SocketEvents.TYPING_START | typeof SocketEvents.TYPING_STOP,
        payload: TypingEventPayload
    ) => {
        const { conversationId, conversationMembers = [] } = payload;
        if (!conversationId) return;

        const senderId = socket.data.userId;
        const recipients = Array.from(
            new Set(
                conversationMembers
                    .map((memberId) => String(memberId))
                    .filter((memberId) => memberId && memberId !== senderId)
            )
        );

        if (recipients.length > 0) {
            for (const userId of recipients) {
                io.to(`user:${userId}`).emit(eventName, {
                    conversationId,
                    userId: senderId,
                });
            }
            return;
        }

        const room = `conversation:${conversationId}`;
        socket.to(room).emit(eventName, {
            conversationId,
            userId: senderId,
        });
    };

    socket.on(SocketEvents.TYPING_START, (payload: TypingEventPayload) => {
        relayTypingEvent(SocketEvents.TYPING_START, payload);
    });

    socket.on(SocketEvents.TYPING_STOP, (payload: TypingEventPayload) => {
        relayTypingEvent(SocketEvents.TYPING_STOP, payload);
    });
}