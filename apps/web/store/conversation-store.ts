import { create } from "zustand";
import { ClientConversation } from "@semantask/types";
import { ClientMessage } from "@semantask/types";
import { socket } from "@/lib/socket/socketClient";
import { SocketEvents } from "@semantask/types";

interface ChatStore {
    selectedConversation: ClientConversation | null;
    conversations: (ClientConversation & { unreadCount?: number })[]; // added unreadCount
    messages: ClientMessage[];
    hasMore: boolean;
    onlineUsers: string[];


    // setters
    setSelectedConversation: (conversation: ClientConversation | null) => void;
    setConversations: (convs: ClientConversation[]) => void;
    setHasMore: (val: boolean) => void;
    setOnlineUsers: (users: string[]) => void;

    // messages
    setMessages: (msgs: ClientMessage[], appendToTop?: boolean) => void;
    addMessage: (msg: ClientMessage) => void;
    replaceTempMessage: (tempId: string, newMsg: ClientMessage) => void;
    clearTempMessages: () => void;
    //updateMessageReactions: (id: string, reactions: string[]) => void;
    updateEditedMessage: (updatedMessage: ClientMessage) => void;


    // conversation helpers
    updateLastMessage: (conversationId: string, msg: ClientMessage) => void;
    incrementUnread: (conversationId: string) => void;
    clearUnread: (conversationId: string) => void;
}
export const reactToMessage = (msg: ClientMessage, emoji: string) => {
    socket.emit(SocketEvents.MESSAGE_REACTION, {
        messageId: msg._id,
        emoji,
    });
};

const useConversationStore = create<ChatStore>((set, get) => ({
    selectedConversation: null,
    conversations: [],
    messages: [],
    hasMore: true,
    onlineUsers: [],

    setSelectedConversation: (conversation) =>
        set({
            selectedConversation: conversation,
            messages: [],
            hasMore: true,
            conversations: get().conversations.map((c) =>
                c._id === conversation?._id ? { ...c, unreadCount: 0 } : c
            ) as (ClientConversation & { unreadCount?: number })[],
        }),

    setConversations: (convs) => set({ conversations: convs }),
    setHasMore: (val) => set({ hasMore: val }),
    setOnlineUsers: (users) => set({ onlineUsers: users }),

    setMessages: (msgs, appendToTop = false) =>
        set((state) => {
            const confirmedIds = new Set(msgs.map((m) => m._id.toString()));
            const tempMessages = state.messages.filter(
                (m) => m._id.toString().startsWith("temp_") && !confirmedIds.has(m._id.toString())
            );

            const all = appendToTop
                ? [...msgs, ...state.messages.filter((m) => !m._id.toString().startsWith("temp_"))]
                : [...state.messages.filter((m) => !m._id.toString().startsWith("temp_")), ...msgs];

            const combined = [...all, ...tempMessages];

            const unique = Array.from(new Map(combined.map((m) => [m._id.toString(), m])).values());

            return { messages: unique };
        }),

    addMessage: (msg) =>
        set((state) => {
            const exists = state.messages.some((m) => m._id.toString() === msg._id.toString());
            if (exists) return {};

            // If the message belongs to the selected conversation, just add it
            const selectedConvId = state.selectedConversation?._id;
            if (msg.conversationId && msg.conversationId !== selectedConvId) {
                // Increment unread count
                get().incrementUnread(msg.conversationId.toString());
            }

            return { messages: [...state.messages, msg] };
        }),

    replaceTempMessage: (tempId, realMessage) =>
        set((state) => {
            const newMessages = state.messages.map((msg) =>
                msg._id.toString() === tempId ? realMessage : msg
            );
            const exists = newMessages.some((m) => m._id.toString() === realMessage._id.toString());
            if (!exists) newMessages.push(realMessage);

            return { messages: newMessages };
        }),

    clearTempMessages: () =>
        set((state) => ({
            messages: state.messages.filter((m) => !m._id.toString().startsWith("temp_")),
        })),

    updateLastMessage: (conversationId, message) =>
        set((state) => ({
            conversations: state.conversations.map((conv) =>
                conv._id.toString() === conversationId ? { ...conv, lastMessage: message } : conv
            ) as (ClientConversation & { unreadCount?: number })[],
        })),

    incrementUnread: (conversationId) =>
        set((state) => ({
            conversations: state.conversations.map((conv) =>
                conv._id.toString() === conversationId
                    ? { ...conv, unreadCount: (conv.unreadCount || 0) + 1 }
                    : conv
            ) as (ClientConversation & { unreadCount?: number })[],
        })),
    //     updateMessageReactions: (id, reactions) =>
    //   set((state) => ({
    //     messages: state.messages.map((m) =>
    //       m._id === id ? { ...m, reactions } : m
    //     ),
    //   })),

    updateEditedMessage: (updatedMessage) =>
        set((state) => ({
            messages: state.messages.map((m) =>
                m._id === updatedMessage._id ? updatedMessage : m
            ),
        })),

    clearUnread: (conversationId) =>
        set((state) => ({
            conversations: state.conversations.map((conv) =>
                conv._id.toString() === conversationId ? { ...conv, unreadCount: 0 } : conv
            ) as (ClientConversation & { unreadCount?: number })[],
        })),
}));
console.log(useConversationStore);