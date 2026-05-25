import { io, type Socket } from "socket.io-client";

import { tokenStore } from "@/features/auth/api/tokenStore";
import { ENV } from "@/shared/config/env";

const SOCKET_PATH = "/api/socket";

type SocketAuth = {
    token: string;
    deviceId: string;
};

type SocketCallback = (...args: any[]) => void;
type SocketAck = (...args: any[]) => void;

let socketInstance: Socket | null = null;
let connectPromise: Promise<Socket | null> | null = null;
const listenerRegistry = new Map<string, Set<SocketCallback>>();

function log(message: string, ...args: unknown[]) {
    console.log(`[socket] ${message}`, ...args);
}

function ensureSocket() {
    if (socketInstance) {
        return socketInstance;
    }

    socketInstance = io(ENV.SOCKET_URL, {
        path: SOCKET_PATH,
        autoConnect: false,
        transports: ["websocket"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
    });

    socketInstance.on("connect", () => {
        log("connected", { id: socketInstance?.id });
    });

    socketInstance.on("disconnect", (reason) => {
        log("disconnected", { reason });
    });

    socketInstance.on("connect_error", (error) => {
        log("connect_error", error?.message ?? error);
    });

    socketInstance.io.on("reconnect_attempt", (attempt) => {
        log("reconnect_attempt", { attempt });
    });

    socketInstance.io.on("reconnect", (attempt) => {
        log("reconnect", { attempt });
    });

    socketInstance.io.on("reconnect_error", (error) => {
        log("reconnect_error", error?.message ?? error);
    });

    socketInstance.io.on("reconnect_failed", () => {
        log("reconnect_failed");
    });

    return socketInstance;
}

async function resolveAuth(): Promise<SocketAuth | null> {
    const [token, deviceId] = await Promise.all([
        tokenStore.getAccessToken(),
        tokenStore.getOrCreateDeviceId(),
    ]);

    if (!token) {
        return null;
    }

    return { token, deviceId };
}

function applyAuth(auth: SocketAuth) {
    const socket = ensureSocket();
    (socket as Socket & { auth?: SocketAuth }).auth = auth;
    (socket.io.opts as { auth?: SocketAuth }).auth = auth;
}

export const socketClient = {
    getSocket() {
        return ensureSocket();
    },

    async connect() {
        if (connectPromise) {
            return connectPromise;
        }

        connectPromise = (async () => {
            const auth = await resolveAuth();

            if (!auth) {
                log("connect skipped: no JWT token found");
                socketClient.disconnect();
                return null;
            }

            const socket = ensureSocket();
            applyAuth(auth);

            if (!socket.connected) {
                log("connecting", { url: ENV.SOCKET_URL, path: SOCKET_PATH });
                socket.connect();
            }

            return socket;
        })().finally(() => {
            connectPromise = null;
        });

        return connectPromise;
    },

    disconnect() {
        if (!socketInstance) {
            return;
        }

        if (socketInstance.connected) {
            log("disconnecting");
        }

        socketInstance.disconnect();
    },

    emit(event: string, payload?: unknown, ack?: SocketAck) {
        if (ack) {
            ensureSocket().emit(event, payload, ack);
            return;
        }

        ensureSocket().emit(event, payload);
    },

    on(event: string, callback: SocketCallback) {
        const socket = ensureSocket();
        const registered = listenerRegistry.get(event) ?? new Set<SocketCallback>();

        if (registered.has(callback)) {
            return;
        }

        registered.add(callback);
        listenerRegistry.set(event, registered);
        socket.on(event, callback);
    },

    off(event: string, callback: SocketCallback) {
        if (!socketInstance) {
            listenerRegistry.get(event)?.delete(callback);
            return;
        }

        socketInstance.off(event, callback);
        listenerRegistry.get(event)?.delete(callback);

        if (listenerRegistry.get(event)?.size === 0) {
            listenerRegistry.delete(event);
        }
    },
};

export type SocketClient = typeof socketClient;