import { Server, Socket } from "socket.io";
import { SocketEvents } from "@semantask/types";

export function JoinHandler(io: Server, socket: Socket) {

    socket.on(SocketEvents.CONVERSATION_JOIN, (payload: { conversationId: string }) => {
        const { conversationId } = payload;
        if (!conversationId) return;
        socket.join(`conversation:${conversationId}`);
    });
}