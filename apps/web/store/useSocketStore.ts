// src/store/useSocketStore.ts
"use client";

import { create } from "zustand";
import { getSocket } from "@/lib/socket/socketClient";
import { MessageEditPayload, SocketEvents } from "@semantask/types";
import type { MessageDTO } from "@semantask/types";
import useChatStore from "./chat-store";

interface SocketState {
    connected: boolean;
    currentConversationId: string | null;
    onlineUsers: string[];
    typingUsers: Record<string, string[]>; // conversationId -> userIds[]

    connect: () => void;
    disconnect: () => void;
    joinConversation: (conversationId: string) => void;
    leaveConversation: (conversationId: string) => void;

    startTyping: (conversationId: string, userId: string) => void;
    stopTyping: (conversationId: string, userId: string) => void;
    sendMessage: (payload: MessageDTO & { tempId?: string }, conversationMembers: string[]) => void;
    editMessageUpdate: (msg: MessageEditPayload) => void;
}

const useSocketStore = create<SocketState>((set, get) => ({
    connected: false,
    currentConversationId: null,
    onlineUsers: [],
    typingUsers: {},

    connect: () => {
        const socket = getSocket();
        if (!socket.connected) socket.connect();
    },

    disconnect: () => {
        const socket = getSocket();
        if (socket.connected) socket.disconnect();
    },

    joinConversation: (conversationId: string) => {
        const socket = getSocket();
        const prev = get().currentConversationId;

        if (prev && prev !== conversationId) {
            socket.emit(SocketEvents.CONVERSATION_LEAVE, { conversationId: prev });
        }
        socket.emit(SocketEvents.CONVERSATION_JOIN, { conversationId });
        set({ currentConversationId: conversationId });
    },

    leaveConversation: (conversationId) => {
        const socket = getSocket();
        socket.emit(SocketEvents.CONVERSATION_LEAVE, { conversationId });
        set({ currentConversationId: null });
    },

    startTyping: (conversationId, userId) => {
        const socket = getSocket();
        socket.emit(SocketEvents.TYPING_START, { conversationId, userId });
    },

    stopTyping: (conversationId, userId) => {
        const socket = getSocket();
        socket.emit(SocketEvents.TYPING_STOP, { conversationId, userId });
    },

    sendMessage: (payload, conversationMembers) => {
        const socket = getSocket();
        socket.emit(SocketEvents.MESSAGE_SEND, { data: payload, conversationMembers: conversationMembers });


        // Optimistic UI insert
        if (payload.tempId) {
            useChatStore.getState().addOptimisticMessage(payload.conversationId, {
                _id: payload.tempId,
                sender: payload.sender,
                conversationId: payload.conversationId,
                isDeleted: false,
                content: payload.content,
                messageType: payload.messageType,
                status: "pending",
                createdAt: new Date(),
            });
        }
    },
    editMessageUpdate: (msg) => {
        const socket = getSocket();
        socket.emit(SocketEvents.MESSAGE_EDIT, msg);
    },
}));

export default useSocketStore;