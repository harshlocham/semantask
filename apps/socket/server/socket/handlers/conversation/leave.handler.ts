import { Server, Socket } from "socket.io";
import { SocketEvents } from "@semantask/types";

export function LeaveHandler(io: Server, socket: Socket) {
    socket.on(SocketEvents
        .CONVERSATION_LEAVE, (payload: { conversationId: string }) => {
            const { conversationId } = payload;
            if (!conversationId) return;
            socket.leave(`conversation:${conversationId}`);
        }
    )
}
