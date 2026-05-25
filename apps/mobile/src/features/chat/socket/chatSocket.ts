import type { Socket } from "socket.io-client";

import {
    chatStoreUtils,
    type ChatMessageInput,
    useChatStore,
} from "@/features/chat/store/chatStore";
import { normalizeConversation } from "@/features/chat/api/chatApi";
import { socketClient } from "@/lib/socket";

export const ChatSocketEvents = {
    MESSAGE_SEND: "message:send",
    MESSAGE_NEW: "message:new",
    MESSAGE_SEEN: "message:seen",
    TYPING_START: "typing:start",
    TYPING_STOP: "typing:stop",
    SYNC_MESSAGES: "sync:messages",
    SYNC_CONVERSATIONS: "sync:conversations",
    CONVERSATION_JOIN: "conversation:join",
    CONVERSATION_LEAVE: "conversation:leave",
    CONVERSATION_UPDATED: "conversation:updated",
    ERROR_AUTH: "error:auth",
} as const;

export async function createChatSocket() {
    await socketClient.connect();
    return socketClient.getSocket();
}

export function initializeChatSocketListeners(
    socket: Socket,
    options?: {
        onAuthError?: () => void;
    }
) {
    const handleConnect = () => {
        const selectedConversationId = useChatStore.getState().selectedConversationId;

        if (selectedConversationId) {
            socket.emit(ChatSocketEvents.CONVERSATION_JOIN, {
                conversationId: selectedConversationId,
            });
        }
    };

    const handleMessageNew = (message: unknown) => {
        useChatStore.getState().receiveMessage(chatStoreUtils.normalizeChatMessage(message as ChatMessageInput));
    };

    const handleSyncMessages = (payload: unknown) => {
        const value = payload as { conversationId?: unknown; messages?: unknown[]; appendToTop?: boolean };

        const conversationId = chatStoreUtils.toStringId(value.conversationId);
        const messages = Array.isArray(value.messages)
            ? value.messages.map((message) => chatStoreUtils.normalizeChatMessage(message as ChatMessageInput))
            : [];

        if (!conversationId) {
            return;
        }

        useChatStore.getState().setMessages(
            conversationId,
            messages,
            value.appendToTop ? "prepend" : "replace"
        );
    };

    const handleSyncConversations = (payload: unknown) => {
        const conversations = Array.isArray(payload) ? payload : [];

        useChatStore.getState().setConversations(
            conversations.map((conversation) => normalizeConversation(conversation))
        );
    };

    const handleConversationUpdated = (payload: unknown) => {
        useChatStore.getState().upsertConversation(normalizeConversation(payload));
    };

    const handleAuthError = () => {
        options?.onAuthError?.();
    };

    socket.on("connect", handleConnect);
    socket.on(ChatSocketEvents.MESSAGE_NEW, handleMessageNew);
    socket.on(ChatSocketEvents.SYNC_MESSAGES, handleSyncMessages);
    socket.on(ChatSocketEvents.SYNC_CONVERSATIONS, handleSyncConversations);
    socket.on(ChatSocketEvents.CONVERSATION_UPDATED, handleConversationUpdated);
    socket.on(ChatSocketEvents.ERROR_AUTH, handleAuthError);

    return () => {
        socket.off("connect", handleConnect);
        socket.off(ChatSocketEvents.MESSAGE_NEW, handleMessageNew);
        socket.off(ChatSocketEvents.SYNC_MESSAGES, handleSyncMessages);
        socket.off(ChatSocketEvents.SYNC_CONVERSATIONS, handleSyncConversations);
        socket.off(ChatSocketEvents.CONVERSATION_UPDATED, handleConversationUpdated);
        socket.off(ChatSocketEvents.ERROR_AUTH, handleAuthError);
    };
}

export function disconnectChatSocket(socket: Socket, cleanup?: () => void) {
    cleanup?.();
    socketClient.disconnect();
}