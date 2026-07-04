"use client";

import { useEffect } from "react";
import { getSocket } from "@/lib/socket/socketClient";
import useChatStore from "@/store/chat-store";
import { SocketEvents } from "@semantask/types";

const HEARTBEAT_MS = 4_000;

export function useSocketPresence(currentUserId?: string | null) {
    const addOnlineUser = useChatStore((s) => s.addOnlineUser);
    const removeOnlineUser = useChatStore((s) => s.removeOnlineUser);
    const setCurrentUserId = useChatStore((s) => s.setCurrentUserId);

    useEffect(() => {
        setCurrentUserId(currentUserId ?? null);
    }, [currentUserId, setCurrentUserId]);

    useEffect(() => {
        const socket = getSocket();
        let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

        const stopHeartbeat = () => {
            if (!heartbeatTimer) return;
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        };

        const startHeartbeat = () => {
            stopHeartbeat();

            if (!socket.connected) return;

            socket.emit(SocketEvents.PRESENCE_PING, { at: new Date().toISOString() });
            heartbeatTimer = setInterval(() => {
                if (!socket.connected) return;
                socket.emit(SocketEvents.PRESENCE_PING, { at: new Date().toISOString() });
            }, HEARTBEAT_MS);
        };

        const handleOnline = ({ userId }: { userId: string }) => {
            if (!userId) return;
            addOnlineUser(userId);
        };

        const handleOffline = ({ userId }: { userId: string }) => {
            if (!userId) return;
            removeOnlineUser(userId);
        };

        const handleConnect = () => {
            if (currentUserId) addOnlineUser(currentUserId);
            startHeartbeat();
        };

        const handleDisconnect = () => {
            stopHeartbeat();
            if (currentUserId) removeOnlineUser(currentUserId);
        };

        socket.on("connect", handleConnect);
        socket.on("disconnect", handleDisconnect);
        socket.on(SocketEvents.USER_ONLINE, handleOnline);
        socket.on(SocketEvents.USER_OFFLINE, handleOffline);

        if (socket.connected) {
            handleConnect();
        }

        return () => {
            stopHeartbeat();
            socket.off("connect", handleConnect);
            socket.off("disconnect", handleDisconnect);
            socket.off(SocketEvents.USER_ONLINE, handleOnline);
            socket.off(SocketEvents.USER_OFFLINE, handleOffline);
        };
    }, [addOnlineUser, removeOnlineUser, currentUserId]);
}
