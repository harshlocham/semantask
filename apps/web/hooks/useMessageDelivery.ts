"use client";

import { useEffect, useRef } from "react";
import { getSocket } from "@/lib/socket/socketClient";
import {
    type MessageDTO,
    MessageDeliveredUpdatePayload,
    MessageSeenUpdatePayload,
    SocketEvents,
} from "@semantask/types";
import useChatStore from "@/store/chat-store";
import { markDelivered } from "@/lib/services/delivery.service";
import { markSeen } from "@/lib/services/seen.service";

interface UseMessageDeliveryParams {
    conversationId?: string | null;
    currentUserId?: string | null;
}

export function useMessageDelivery({
    conversationId,
    currentUserId,
}: UseMessageDeliveryParams) {
    const markMessageDelivered = useChatStore((s) => s.markMessageDelivered);
    const markMessagesSeen = useChatStore((s) => s.markMessagesSeen);
    const messagesByConversation = useChatStore((s) => s.messagesByConversation);

    const deliveredSentRef = useRef(new Set<string>());
    const seenSentRef = useRef(new Set<string>());

    useEffect(() => {
        const socket = getSocket();

        const emitDelivered = async (msg: MessageDTO) => {
            if (!currentUserId) return;
            if (!msg?._id || !msg.conversationId) return;

            const receiptKey = `${msg._id}:delivered:${currentUserId}`;
            if (deliveredSentRef.current.has(receiptKey)) return;

            deliveredSentRef.current.add(receiptKey);

            const senderId =
                typeof msg.sender === "string"
                    ? msg.sender
                    : msg.sender?._id;

            if (!senderId) return;

            try {
                await markDelivered(msg._id, {
                    conversationId: msg.conversationId,
                    at: Date.now(),
                });
            } catch (error) {
                console.error("Failed to mark delivered", error);
            }

            socket.emit(SocketEvents.MESSAGE_DELIVERED, {
                messageId: msg._id,
                conversationId: msg.conversationId,
                senderId,
                at: new Date().toISOString(),
            });
        };

        const emitSeen = async (targetConversationId: string, ids: string[]) => {
            if (!currentUserId || !targetConversationId || ids.length === 0) return;

            const pendingIds = ids.filter((id) => {
                const key = `${id}:seen:${currentUserId}`;
                if (seenSentRef.current.has(key)) return false;
                seenSentRef.current.add(key);
                return true;
            });

            if (pendingIds.length === 0) return;

            try {
                await markSeen(targetConversationId, pendingIds);
            } catch (error) {
                console.error("Failed to mark seen", error);
            }

            socket.emit(SocketEvents.MESSAGE_SEEN, {
                conversationId: targetConversationId,
                messageIds: pendingIds,
                at: new Date().toISOString(),
            });
        };

        const handleNewMessage = (msg: MessageDTO) => {
            if (!currentUserId || !msg?.sender?._id) return;
            if (String(msg.sender._id) === String(currentUserId)) return;

            if (conversationId && msg.conversationId === conversationId) {
                void emitSeen(msg.conversationId, [msg._id]);
                return;
            }

            void emitDelivered(msg);
        };

        const handleDeliveredUpdate = (payload: MessageDeliveredUpdatePayload) => {
            if (!payload?.conversationId || !payload?.messageId || !payload?.userId) return;
            markMessageDelivered(payload.conversationId, payload.messageId, payload.userId);
        };

        const handleSeenUpdate = (payload: MessageSeenUpdatePayload) => {
            if (!payload?.conversationId || !payload?.messageIds?.length || !payload?.userId) {
                return;
            }
            markMessagesSeen(payload.conversationId, payload.messageIds, payload.userId);
        };

        socket.on(SocketEvents.MESSAGE_NEW, handleNewMessage);
        socket.on(SocketEvents.MESSAGE_DELIVERED_UPDATE, handleDeliveredUpdate);
        socket.on(SocketEvents.MESSAGE_SEEN_UPDATE, handleSeenUpdate);

        return () => {
            socket.off(SocketEvents.MESSAGE_NEW, handleNewMessage);
            socket.off(SocketEvents.MESSAGE_DELIVERED_UPDATE, handleDeliveredUpdate);
            socket.off(SocketEvents.MESSAGE_SEEN_UPDATE, handleSeenUpdate);
        };
    }, [
        conversationId,
        currentUserId,
        markMessageDelivered,
        markMessagesSeen,
    ]);

    useEffect(() => {
        if (!conversationId || !currentUserId) return;

        const messages = messagesByConversation[conversationId] || [];
        const pendingSeenIds = messages
            .filter((msg) => {
                const senderId = typeof msg.sender === "string" ? msg.sender : msg.sender?._id;
                if (!senderId || String(senderId) === String(currentUserId)) return false;
                return !(msg.seenBy || []).includes(String(currentUserId));
            })
            .map((msg) => String(msg._id));

        if (pendingSeenIds.length === 0) return;

        void markSeen(conversationId, pendingSeenIds)
            .then(() => {
                const socket = getSocket();
                socket.emit(SocketEvents.MESSAGE_SEEN, {
                    conversationId,
                    messageIds: pendingSeenIds,
                    at: new Date().toISOString(),
                });
            })
            .catch((error: unknown) => {
                console.error("Failed to mark seen", error);
            });

        pendingSeenIds.forEach((id) => {
            seenSentRef.current.add(`${id}:seen:${currentUserId}`);
        });
    }, [conversationId, currentUserId, messagesByConversation]);
}
