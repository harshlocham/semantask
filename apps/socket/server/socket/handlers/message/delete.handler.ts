import { Server, Socket } from "socket.io";
import { SocketEvents } from "@semantask/types";
import { authorizeMessageAction } from "../../services/message-action-authorization.js";

export function DeleteHandler(io: Server, socket: Socket) {
    socket.on(SocketEvents.MESSAGE_DELETE, async (payload: { conversationId: string, messageId: string }) => {
        const conversationId = payload?.conversationId;
        const messageId = payload?.messageId;

        if (!conversationId || !messageId) {
            socket.emit(SocketEvents.ERROR_MESSAGE, {
                type: "validation_error",
                message: "Invalid delete payload",
            });
            return;
        }

        const room = `conversation:${conversationId}`;
        if (!socket.rooms.has(room)) {
            socket.emit(SocketEvents.ERROR_AUTH, {
                type: "forbidden",
                message: "Not joined to target conversation",
            });
            return;
        }

        const authz = await authorizeMessageAction({
            action: "delete",
            actorUserId: socket.data.userId,
            conversationId,
            messageId,
        });

        if (!authz.allowed) {
            socket.emit(SocketEvents.ERROR_AUTH, {
                type: "forbidden",
                message: "Delete not authorized",
                data: { reason: authz.reason || "forbidden" },
            });
            return;
        }

        // ARCHITECTURE: Socket is transport layer only - no database access
        // Emit minimal payload: { messageId, conversationId }
        // Client handles deletion locally using message id
        io.to(`conversation:${conversationId}`).emit(SocketEvents.MESSAGE_DELETE, {
            messageId,
            conversationId,
        });
    });
}