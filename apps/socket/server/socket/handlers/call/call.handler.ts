// src/server/socket/handlers/call/call.handler.ts
import type { Server as IOServer } from "socket.io";
import {
    ServerToClientEvents,
    ClientToServerEvents,
    CallOfferPayload,
    CallAnswerPayload,
    CallEndPayload,
    CallRingingPayload,
    SocketEvents,
} from "@semantask/types";

type IO = IOServer<ClientToServerEvents, ServerToClientEvents>;
type Socket = import("socket.io").Socket<
    ClientToServerEvents,
    ServerToClientEvents
>;

export function callHandler(io: IO, socket: Socket) {
    socket.on(SocketEvents.CALL_OFFER, ({ to, offer }: CallOfferPayload) => {
        io.to(to).emit(SocketEvents.CALL_OFFER, {
            from: socket.data.userId,
            to,
            offer,
        });
    });

    socket.on(SocketEvents.CALL_ANSWER, ({ to, answer }: CallAnswerPayload) => {
        io.to(to).emit(SocketEvents.CALL_ANSWER, {
            from: socket.data.userId,
            to,
            answer,
        });
    });

    socket.on(SocketEvents.CALL_END, ({ to }: CallEndPayload) => {
        io.to(to).emit(SocketEvents.CALL_END, {
            from: socket.data.userId,
            to,
        });
    });

    socket.on(SocketEvents.CALL_BUSY, ({ to }: CallRingingPayload) => {
        io.to(to).emit(SocketEvents.CALL_BUSY, {
            from: socket.data.userId,
            to,
        });
    });
}