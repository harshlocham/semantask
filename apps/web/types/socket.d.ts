import { Server as IOServer } from "socket.io";
import {
    ServerToClientEvents,
    ClientToServerEvents,
} from "@semantask/types";

type TypedIOServer = IOServer<
    ClientToServerEvents,
    ServerToClientEvents
>;

declare global {
    var io: TypedIOServer | undefined;
}

export { };