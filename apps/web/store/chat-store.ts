// src/store/chat-store.ts
import { create } from "zustand";
import { ClientConversation } from "@chat/types";
import { UIMessage } from "@chat/types";
interface ChatStore {
    selectedConversationId: string | null;
    currentUserId: string | null;
    selectedConversation: ClientConversation | null;
    conversations: ClientConversation[];
    messagesByConversation: Record<string, UIMessage[]>;
    hasMoreByConversation: Record<string, boolean>;
    onlineUsers: string[];
    typingByConversation: Record<string, string[]>; // conversationId -> userIds

    // setters
    setSelectedConversation: (conversation: ClientConversation | null) => void;
    setConversations: (convs: ClientConversation[]) => void;
    upsertConversation: (conversation: ClientConversation) => void;
    setHasMore: (conversationId: string, val: boolean) => void;
    setCurrentUserId: (userId: string | null) => void;
    setOnlineUsers: (users: string[]) => void;
    addOnlineUser: (userId: string) => void;
    removeOnlineUser: (userId: string) => void;

    // messages
    setMessages: (
        conversationId: string,
        msgs: UIMessage[],
        appendToTop?: boolean
    ) => void;

    addOptimisticMessage: (conversationId: string, msg: UIMessage) => void;
    addMessage: (conversationId: string, msg: UIMessage) => void;
    replaceTempMessage: (
        conversationId: string,
        tempId: string,
        newMsg: UIMessage
    ) => void;
    updateMessage: (updatedMessage: UIMessage) => void;
    removeMessage: (conversationId: string, messageId: string) => void;
    updateMessageReactions: (conversationId: string, updated: UIMessage) => void;
    markMessageDelivered: (conversationId: string, messageId: string, userId: string) => void;
    markMessagesSeen: (conversationId: string, messageIds: string[], userId: string) => void;
    clearTempMessages: (conversationId: string) => void;
    updateEditedMessage: (conversationId: string, messageId: string, newText: string) => void;
    updateDeletedMessage: (message: UIMessage) => void;
    repliedTo: Record<string, UIMessage | null>;

    // conversation helpers
    updateLastMessage: (conversationId: string, msg: UIMessage) => void;
    incrementUnread: (conversationId: string) => void;
    clearUnread: (conversationId: string) => void;
    receiveMessage: (
        message: UIMessage
    ) => void;

    // typing
    setTyping: (conversationId: string, userId: string, isTyping: boolean) => void;
    clearTypingConversation: (conversationId: string) => void;
    editingMessage: UIMessage | null;
    setEditingMessage: (msg: ChatStore['editingMessage']) => void;
    clearEditingMessage: () => void;

    setReplyTo: (conversationId: string, msg: UIMessage | null) => void;
    clearReplyTo: (conversationId: string) => void;
}

const idOf = (
    m: { _id?: string | { toString(): string } } | string | null | undefined
): string => {
    if (typeof m === "string") return m;
    if (!m || m._id == null) return "";
    const id = m._id;
    return typeof id === "string" ? id : id.toString();
};

const isTempId = (id: string) => id.startsWith("temp_");

const senderIdOf = (message: UIMessage): string =>
    typeof message.sender === "string"
        ? message.sender
        : String(message.sender?._id ?? "");

const toTimestamp = (value: unknown): number => {
    if (!value) return 0;
    if (value instanceof Date) return value.getTime();

    const parsed = new Date(String(value)).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
};

const getConversationActivityTime = (conversation: ClientConversation): number => {
    const candidate =
        conversation.updatedAt
        ?? conversation.lastMessage?.updatedAt
        ?? conversation.lastMessage?.createdAt
        ?? conversation.createdAt;

    return toTimestamp(candidate);
};

const sortConversationsByActivity = (conversations: ClientConversation[]): ClientConversation[] => {
    return [...conversations].sort(
        (left, right) => getConversationActivityTime(right) - getConversationActivityTime(left)
    );
};

const useChatStore = create<ChatStore>((set) => ({
    selectedConversationId: null,
    selectedConversation: null,
    conversations: [],
    messagesByConversation: {},
    hasMoreByConversation: {},
    onlineUsers: [],
    typingByConversation: {},
    currentUserId: null,

    setSelectedConversation: (conv) =>
        set((state) => {
            const selectedConversationId = conv?._id ? String(conv._id) : null;

            if (!selectedConversationId) {
                return {
                    selectedConversationId: null,
                    selectedConversation: null,
                };
            }

            const existing = state.conversations.find(
                (conversation) => String(conversation._id) === selectedConversationId
            );

            const selectedConversation = {
                ...(existing || {}),
                ...conv,
                unreadCount: 0,
            } as ClientConversation;

            const conversations = existing
                ? state.conversations.map((conversation) =>
                    String(conversation._id) === selectedConversationId
                        ? selectedConversation
                        : conversation
                )
                : [selectedConversation, ...state.conversations];

            return {
                selectedConversationId,
                selectedConversation,
                conversations: sortConversationsByActivity(conversations),
            };
        }),

    setConversations: (convs) =>
        set((state) => ({
            conversations: sortConversationsByActivity(
                convs.map((conversation) => {
                    const existing = state.conversations.find((item) => String(item._id) === String(conversation._id));
                    return {
                        ...existing,
                        ...conversation,
                        unreadCount: conversation.unreadCount ?? existing?.unreadCount ?? 0,
                    };
                })
            ),
        })),

    upsertConversation: (conversation) =>
        set((state) => {
            const conversationId = String(conversation._id);
            const existing = state.conversations.find((item) => String(item._id) === conversationId);
            const nextConversation: ClientConversation = {
                ...existing,
                ...conversation,
                unreadCount: conversation.unreadCount ?? existing?.unreadCount ?? 0,
            };

            const conversations = existing
                ? state.conversations.map((item) =>
                    String(item._id) === conversationId ? nextConversation : item
                )
                : [nextConversation, ...state.conversations];

            const selectedConversation =
                state.selectedConversationId === conversationId
                    ? {
                        ...(state.selectedConversation ?? {}),
                        ...nextConversation,
                    } as ClientConversation
                    : state.selectedConversation;

            return {
                conversations: sortConversationsByActivity(conversations),
                selectedConversation,
            };
        }),
    setCurrentUserId: (userId) => set({ currentUserId: userId }),
    setHasMore: (conversationId, val) =>
        set((state) => ({
            hasMoreByConversation: {
                ...state.hasMoreByConversation,
                [conversationId]: val,
            },
        })),
    setOnlineUsers: (users) => set({ onlineUsers: users }),
    addOnlineUser: (userId) =>
        set((state) => {
            if (state.onlineUsers.includes(userId)) return {};
            return { onlineUsers: [...state.onlineUsers, userId] };
        }),
    removeOnlineUser: (userId) =>
        set((state) => ({
            onlineUsers: state.onlineUsers.filter((id) => id !== userId),
        })),

    setMessages: (conversationId, msgs, appendToTop = false) =>
        set((state) => {
            const prev = state.messagesByConversation[conversationId] || [];

            const confirmedIds = new Set(msgs.map(idOf));

            const tempMessages = prev.filter(
                (m) => isTempId(idOf(m)) && !confirmedIds.has(idOf(m))
            );

            const base = appendToTop
                ? [...msgs, ...prev.filter((m) => !isTempId(idOf(m)))]
                : [...prev.filter((m) => !isTempId(idOf(m))), ...msgs];

            const combined = [...base, ...tempMessages];

            return {
                messagesByConversation: {
                    ...state.messagesByConversation,
                    [conversationId]: Array.from(
                        new Map(combined.map((m) => [idOf(m), m])).values()
                    ),
                },
            };
        }),

    addOptimisticMessage: (conversationId, msg) =>
        set((state) => {
            const current = state.messagesByConversation[conversationId] || [];
            const exists = current.some((m) => idOf(m) === idOf(msg));
            if (exists) return {};

            return {
                conversations: sortConversationsByActivity(state.conversations.map((conv) =>
                    idOf(conv) === conversationId
                        ? {
                            ...conv,
                            lastMessage: msg,
                            updatedAt: (msg.updatedAt ?? msg.createdAt)?.toISOString?.() ?? String(msg.createdAt),
                        }
                        : conv
                ) as (ClientConversation & { unreadCount?: number })[]),
                messagesByConversation: {
                    ...state.messagesByConversation,
                    [conversationId]: [...current, msg],
                },
            };
        }),
    addMessage: (conversationId, msg) =>
        set((state) => {
            const current = state.messagesByConversation[conversationId] || [];
            const exists = current.some((m) => idOf(m) === idOf(msg));
            const selectedId = state.selectedConversationId;

            const conversations = state.conversations.map((conv) => {
                if (idOf(conv) !== conversationId) return conv;

                return {
                    ...conv,
                    lastMessage: msg, // ✅ ALWAYS update
                    updatedAt: (msg.updatedAt ?? msg.createdAt)?.toISOString?.() ?? String(msg.createdAt),
                    unreadCount:
                        conversationId === selectedId
                            ? 0
                            : (conv.unreadCount || 0) + 1,
                };
            }) as (ClientConversation)[];

            if (exists) {
                return { conversations };
            }

            return {
                conversations,
                messagesByConversation: {
                    ...state.messagesByConversation,
                    [conversationId]: [...current, msg],
                },
            };
        }),

    replaceTempMessage: (conversationId, tempId, realMessage) =>
        set((state) => {
            const current = state.messagesByConversation[conversationId] || [];

            const mapped = current.map((m) =>
                idOf(m) === tempId ? realMessage : m
            );

            const deduped = Array.from(
                new Map(mapped.map((m) => [idOf(m), m])).values()
            );

            return {
                conversations: sortConversationsByActivity(state.conversations.map((conv) =>
                    idOf(conv) === conversationId
                        ? {
                            ...conv,
                            lastMessage: realMessage,
                            updatedAt: (realMessage.updatedAt ?? realMessage.createdAt)?.toISOString?.() ?? String(realMessage.createdAt),
                        }
                        : conv
                ) as (ClientConversation)[]),
                messagesByConversation: {
                    ...state.messagesByConversation,
                    [conversationId]: deduped,
                },
            };
        }),
    updateMessage: (updatedMessage) =>
        set((state) => {
            const convId = updatedMessage.conversationId;
            const messages = state.messagesByConversation[convId];
            if (!messages) return {};

            const updated = messages.map((m) =>
                m._id === updatedMessage._id ? updatedMessage : m
            );

            return {
                messagesByConversation: {
                    ...state.messagesByConversation,
                    [convId]: updated,
                },
            };
        }),

    updateEditedMessage: (conversationId, messageId, newText) =>
        set((state) => {
            const messages = state.messagesByConversation[conversationId] || [];
            //  Update messages
            const updatedMessages = messages.map((m) =>
                idOf(m) === messageId
                    ? { ...m, content: newText, isEdited: true }
                    : m
            );

            //  ALWAYS recompute lastMessage safely
            const newLastMessage =
                updatedMessages.length > 0
                    ? updatedMessages[updatedMessages.length - 1]
                    : undefined;

            return {
                messagesByConversation: {
                    ...state.messagesByConversation,
                    [conversationId]: updatedMessages,
                },
                conversations: state.conversations.map((conv) =>
                    idOf(conv) === conversationId
                        ? {
                            ...conv,
                            lastMessage: newLastMessage,
                            updatedAt: newLastMessage
                                ? ((newLastMessage.updatedAt ?? newLastMessage.createdAt)?.toISOString?.() ?? String(newLastMessage.createdAt))
                                : conv.updatedAt,
                        }
                        : conv
                ) as (ClientConversation)[],
            };
        }),

    removeMessage: (conversationId, messageId) =>
        set((state) => {
            const current = state.messagesByConversation[conversationId] || [];
            return {
                messagesByConversation: {
                    ...state.messagesByConversation,
                    [conversationId]: current.filter((m) => idOf(m) !== messageId),
                },
            };
        }),
    updateDeletedMessage: (updatedMessage: UIMessage) =>
        set((state) => {
            const convId = updatedMessage.conversationId;
            const messages = state.messagesByConversation[convId];
            if (!messages) return {};

            const updated = messages.map((m) =>
                m._id === updatedMessage._id ? updatedMessage : m
            );

            const updatedConversations = state.conversations.map((conv) =>
                idOf(conv) === convId
                    ? {
                        ...conv,
                        lastMessage: updated[updated.length - 1],
                        updatedAt: updated[updated.length - 1]
                            ? ((updated[updated.length - 1].updatedAt ?? updated[updated.length - 1].createdAt)?.toISOString?.() ?? String(updated[updated.length - 1].createdAt))
                            : conv.updatedAt,
                    }
                    : conv
            );

            return {
                messagesByConversation: {
                    ...state.messagesByConversation,
                    [convId]: updated,
                },
                conversations: sortConversationsByActivity(updatedConversations),
            };
        }),

    updateMessageReactions: (conversationId, updated) =>
        set((state) => {
            const current = state.messagesByConversation[conversationId] || [];
            const mapped = current.map((m) =>
                idOf(m) === idOf(updated) ? ({ ...m, reactions: updated.reactions } as UIMessage) : m
            );
            return {
                messagesByConversation: {
                    ...state.messagesByConversation,
                    [conversationId]: mapped,
                },
            };
        }),

    markMessageDelivered: (conversationId, messageId, userId) =>
        set((state) => {
            const current = state.messagesByConversation[conversationId] || [];
            const mapped = current.map((message) => {
                if (idOf(message) !== messageId) return message;

                const deliveredTo = Array.from(
                    new Set([...(message.deliveredTo || []), userId])
                );
                const isOwnMessage = senderIdOf(message) === state.currentUserId;

                return {
                    ...message,
                    deliveredTo,
                    delivered: true,
                    status: isOwnMessage && message.status !== "seen" ? "delivered" : message.status,
                };
            });

            return {
                messagesByConversation: {
                    ...state.messagesByConversation,
                    [conversationId]: mapped,
                },
            };
        }),

    markMessagesSeen: (conversationId, messageIds, userId) =>
        set((state) => {
            if (!Array.isArray(messageIds) || messageIds.length === 0) return {};

            const messageIdSet = new Set(messageIds);
            const current = state.messagesByConversation[conversationId] || [];

            const mapped = current.map((message) => {
                if (!messageIdSet.has(idOf(message))) return message;

                const seenBy = Array.from(new Set([...(message.seenBy || []), userId]));
                const deliveredTo = Array.from(
                    new Set([...(message.deliveredTo || []), userId])
                );
                const isOwnMessage = senderIdOf(message) === state.currentUserId;

                return {
                    ...message,
                    seenBy,
                    deliveredTo,
                    delivered: true,
                    seen: true,
                    status: isOwnMessage ? "seen" : message.status,
                };
            });

            return {
                messagesByConversation: {
                    ...state.messagesByConversation,
                    [conversationId]: mapped,
                },
            };
        }),

    clearTempMessages: (conversationId) =>
        set((state) => {
            const current = state.messagesByConversation[conversationId] || [];
            return {
                messagesByConversation: {
                    ...state.messagesByConversation,
                    [conversationId]: current.filter((m) => !isTempId(idOf(m))),
                },
            };
        }),

    updateLastMessage: (conversationId, message) =>
        set((state) => ({
            conversations: sortConversationsByActivity(state.conversations.map((conv) =>
                idOf(conv) === conversationId
                    ? {
                        ...conv,
                        lastMessage: message,
                        updatedAt: (message.updatedAt ?? message.createdAt)?.toISOString?.() ?? String(message.createdAt),
                    }
                    : conv
            ) as (ClientConversation)[]),
        })),

    incrementUnread: (conversationId) =>
        set((state) => ({
            conversations: state.conversations.map((conv) =>
                idOf(conv) === conversationId ? { ...conv, unreadCount: (conv.unreadCount || 0) + 1 } : conv
            ) as (ClientConversation)[],
        })),

    clearUnread: (conversationId) =>
        set((state) => ({
            conversations: state.conversations.map((conv) =>
                idOf(conv) === conversationId ? { ...conv, unreadCount: 0 } : conv
            ) as (ClientConversation)[],
        })),

    setTyping: (conversationId, userId, isTyping) =>
        set((state) => {
            const current = state.typingByConversation[conversationId] || [];
            const setUsers = new Set(current);
            if (isTyping) setUsers.add(userId);
            else setUsers.delete(userId);
            return {
                typingByConversation: {
                    ...state.typingByConversation,
                    [conversationId]: Array.from(setUsers),
                },
            };
        }),
    clearTypingConversation: (conversationId) =>
        set((state) => {
            if (!state.typingByConversation[conversationId]) return {};

            const next = { ...state.typingByConversation };
            delete next[conversationId];

            return {
                typingByConversation: next,
            };
        }),
    editingMessage: null,

    setEditingMessage: (msg) => set({ editingMessage: msg }),
    clearEditingMessage: () => set({ editingMessage: null }),
    receiveMessage: (message: UIMessage) =>
        set((state) => {
            const conversationId = String(message.conversationId);
            const existing = state.messagesByConversation[conversationId] || [];

            if (existing.some((m) => idOf(m) === idOf(message))) {
                return {};
            }

            const updatedMessages = [...existing, message];

            const isOpen = state.selectedConversationId === conversationId;
            const senderId = senderIdOf(message);
            if (!senderId) {
                console.error("Invalid message shape in store:", message);
                return {};
            }
            const isOwn = senderId === state.currentUserId;

            const conversations = state.conversations.map((conv) =>
                idOf(conv) === conversationId
                    ? {
                        ...conv,
                        lastMessage: message,
                        updatedAt: (message.updatedAt ?? message.createdAt)?.toISOString?.() ?? String(message.createdAt),
                        unreadCount:
                            !isOpen && !isOwn
                                ? (conv.unreadCount || 0) + 1
                                : conv.unreadCount || 0,
                    }
                    : conv
            );

            const target = conversations.find((c) => idOf(c) === conversationId);

            return {
                messagesByConversation: {
                    ...state.messagesByConversation,
                    [conversationId]: updatedMessages,
                },
                conversations: target
                    ? sortConversationsByActivity([target, ...conversations.filter((c) => idOf(c) !== conversationId)])
                    : sortConversationsByActivity(conversations),
            };
        }),
    repliedTo: {},
    setReplyTo: (conversationId, msg) =>
        set((state) => ({
            repliedTo: { ...state.repliedTo, [conversationId]: msg },
        })),
    clearReplyTo: (conversationId) =>
        set((state) => ({
            repliedTo: { ...state.repliedTo, [conversationId]: null },
        })),
}));

export default useChatStore;