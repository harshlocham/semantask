import { Socket as IOSocket } from "socket.io";
import {
    ServerToClientEvents,
    ClientToServerEvents,
} from "@semantask/types";

export type SocketData = {
    userId: string;
    isAdmin: boolean;
};

export type TypedSocket = IOSocket<
    ClientToServerEvents,
    ServerToClientEvents,
    SocketData
>;