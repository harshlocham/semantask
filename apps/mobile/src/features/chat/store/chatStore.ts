import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ChatMessageType =
    | "text"
    | "image"
    | "file"
    | "system"
    | "video"
    | "audio"
    | "voice";

export type ChatMessageStatus =
    | "pending"
    | "failed"
    | "sent"
    | "delivered"
    | "seen"
    | "queued";

export type ChatParticipant = {
    _id: string;
    name: string;
    username?: string;
    profilePicture?: string | null;
    isOnline?: boolean;
    lastSeen?: string | null;
};

export type ChatMessageInput = {
    _id: string;
    conversationId: string;
    content: string;
    messageType: ChatMessageType;
    sender: ChatParticipant | string;
    createdAt: string;
    updatedAt?: string;
    isDeleted?: boolean;
    isEdited?: boolean;
    editedAt?: string;
    delivered?: boolean;
    seen?: boolean;
    status?: ChatMessageStatus;
    isTemp?: boolean;
};

export type ChatMessage = ChatMessageInput & {
    sender: ChatParticipant;
    status: ChatMessageStatus;
};

export type ChatConversation = {
    _id: string;
    type: "direct" | "group";
    participants: ChatParticipant[];
    name?: string;
    image?: string;
    isGroup: boolean;
    groupName?: string;
    admin?: string;
    lastMessage?: ChatMessage;
    unreadCount?: number;
    createdAt?: string;
    updatedAt?: string;
};

type SetMessagesMode = "replace" | "append" | "prepend";

type ChatStoreState = {
    selectedConversationId: string | null;
    currentUserId: string | null;
    conversations: ChatConversation[];
    messagesByConversation: Record<string, ChatMessage[]>;
    hasMoreByConversation: Record<string, boolean>;
    typingUsersByConversation: Record<string, Record<string, ChatParticipant>>;

    setSelectedConversationId: (conversationId: string | null) => void;
    setCurrentUserId: (userId: string | null) => void;
    setConversations: (conversations: ChatConversation[]) => void;
    upsertConversation: (conversation: ChatConversation) => void;
    incrementUnread: (conversationId: string) => void;
    clearUnread: (conversationId: string) => void;

    setMessages: (
        conversationId: string,
        messages: ChatMessageInput[],
        mode?: SetMessagesMode
    ) => void;
    addMessage: (conversationId: string, message: ChatMessageInput) => void;
    addOptimisticMessage: (conversationId: string, message: ChatMessageInput) => void;
    receiveMessage: (message: ChatMessageInput) => void;
    replaceTempMessage: (
        conversationId: string,
        tempId: string,
        message: ChatMessageInput
    ) => void;
    clearMessages: (conversationId: string) => void;
    removeMessage: (conversationId: string, messageId: string) => void;
    updateMessageStatus: (
        conversationId: string,
        messageId: string,
        status: ChatMessageStatus
    ) => void;
    markMessageSeen: (messageId: string, userId: string) => void;
    setTypingUser: (conversationId: string, user: ChatParticipant) => void;
    removeTypingUser: (conversationId: string, userId: string) => void;
    clearTypingUsers: (conversationId: string) => void;
    setHasMore: (conversationId: string, hasMore: boolean) => void;
    resetChatSession: () => void;
};

const initialState = {
    selectedConversationId: null as string | null,
    currentUserId: null as string | null,
    conversations: [] as ChatConversation[],
    messagesByConversation: {} as Record<string, ChatMessage[]>,
    hasMoreByConversation: {} as Record<string, boolean>,
    typingUsersByConversation: {} as Record<string, Record<string, ChatParticipant>>,
};

const EMPTY_MESSAGE_LIST: ChatMessage[] = [];
const EMPTY_TYPING_USER_MAP: Record<string, ChatParticipant> = {};

const tempIdPrefix = "temp_";

const toStringId = (value: unknown): string => {
    if (typeof value === "string") {
        return value;
    }

    if (!value || typeof value !== "object") {
        return "";
    }

    const candidate = (value as { _id?: unknown; id?: unknown })._id ?? (value as { id?: unknown }).id;

    if (typeof candidate === "string") {
        return candidate;
    }

    if (candidate && typeof candidate === "object" && "toString" in candidate) {
        return String(candidate.toString());
    }

    return "";
};

const isTempMessageId = (messageId: string) => messageId.startsWith(tempIdPrefix);

const normalizeParticipant = (participant: ChatParticipant | string): ChatParticipant => {
    if (typeof participant === "string") {
        return {
            _id: participant,
            name: participant,
            username: participant,
            profilePicture: null,
            isOnline: false,
            lastSeen: null,
        };
    }

    const normalizedName =
        typeof participant.name === "string" && participant.name.trim()
            ? participant.name
            : typeof participant.username === "string" && participant.username.trim()
                ? participant.username
                : "Unknown";

    return {
        _id: toStringId(participant._id),
        name: normalizedName,
        username: participant.username,
        profilePicture: participant.profilePicture ?? null,
        isOnline: participant.isOnline ?? false,
        lastSeen: typeof participant.lastSeen === "string" ? participant.lastSeen : null,
    };
};

export const normalizeChatMessage = (message: ChatMessageInput): ChatMessage => ({
    ...message,
    _id: toStringId(message._id),
    conversationId: toStringId(message.conversationId),
    sender: normalizeParticipant(message.sender),
    status: message.status ?? (message.seen ? "seen" : message.delivered ? "delivered" : "sent"),
});

const normalizeConversation = (conversation: ChatConversation): ChatConversation => ({
    ...conversation,
    _id: toStringId(conversation._id),
    participants: Array.isArray(conversation.participants)
        ? conversation.participants.map(normalizeParticipant)
        : [],
    lastMessage: conversation.lastMessage ? normalizeChatMessage(conversation.lastMessage) : undefined,
});

const dedupeMessages = (messages: ChatMessage[]) => {
    const seen = new Map<string, ChatMessage>();

    for (const message of messages) {
        seen.set(message._id, message);
    }

    return Array.from(seen.values());
};

const syncConversationPreview = (
    conversations: ChatConversation[],
    conversationId: string,
    message: ChatMessage,
    options: {
        selectedConversationId: string | null;
        currentUserId: string | null;
        incrementUnread: boolean;
    }
) => {
    const existingConversation = conversations.find((conversation) => conversation._id === conversationId);
    const baseConversation: ChatConversation =
        existingConversation ??
        ({
            _id: conversationId,
            type: "direct",
            participants: [],
            isGroup: false,
        } as ChatConversation);

    const shouldResetUnread =
        options.selectedConversationId === conversationId || message.sender._id === options.currentUserId;

    const unreadCount = shouldResetUnread
        ? 0
        : options.incrementUnread
            ? (baseConversation.unreadCount ?? 0) + 1
            : baseConversation.unreadCount ?? 0;

    const nextConversation: ChatConversation = {
        ...baseConversation,
        lastMessage: message,
        unreadCount,
    };

    if (existingConversation) {
        return conversations.map((conversation) =>
            conversation._id === conversationId ? nextConversation : conversation
        );
    }

    return [nextConversation, ...conversations];
};

const upsertMessages = (
    current: ChatMessage[],
    incoming: ChatMessage[],
    mode: SetMessagesMode
) => {
    const currentWithoutTemps = current.filter((message) => !isTempMessageId(message._id));
    const nextBase =
        mode === "prepend"
            ? [...incoming, ...currentWithoutTemps]
            : mode === "append"
                ? [...currentWithoutTemps, ...incoming]
                : incoming;

    return dedupeMessages([
        ...nextBase,
        ...current.filter((message) => isTempMessageId(message._id)),
    ]);
};

const getConversationTimestamp = (conversation: ChatConversation) => {
    const candidate = conversation.updatedAt ?? conversation.lastMessage?.updatedAt ?? conversation.lastMessage?.createdAt ?? conversation.createdAt;

    if (!candidate) {
        return 0;
    }

    const parsed = new Date(candidate).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
};

const sortConversations = (
    conversations: ChatConversation[],
    selectedConversationId: string | null
) => {
    return [...conversations].sort((left, right) => {
        const leftSelected = left._id === selectedConversationId;
        const rightSelected = right._id === selectedConversationId;

        if (leftSelected !== rightSelected) {
            return leftSelected ? -1 : 1;
        }

        return getConversationTimestamp(right) - getConversationTimestamp(left);
    });
};

const withStatus = (message: ChatMessage, status: ChatMessageStatus): ChatMessage => {
    if (status === "seen") {
        return {
            ...message,
            status,
            seen: true,
            delivered: true,
        };
    }

    if (status === "delivered") {
        return {
            ...message,
            status,
            delivered: true,
        };
    }

    return {
        ...message,
        status,
    };
};

export const useChatStore = create<ChatStoreState>()(
    persist(
        (set, get) => ({
            ...initialState,

            setSelectedConversationId: (conversationId) =>
                set((state) => ({
                    selectedConversationId: conversationId,
                    conversations: sortConversations(
                        conversationId
                            ? state.conversations.map((conversation) =>
                                conversation._id === conversationId
                                    ? { ...conversation, unreadCount: 0 }
                                    : conversation
                            )
                            : state.conversations,
                        conversationId
                    ),
                })),

            setCurrentUserId: (userId) => set({ currentUserId: userId }),

            setConversations: (conversations) =>
                set((state) => ({
                    conversations: sortConversations(
                        conversations.map((conversation) => {
                            const nextConversation = normalizeConversation(conversation);
                            const existing = state.conversations.find(
                                (item) => item._id === nextConversation._id
                            );

                            return {
                                ...existing,
                                ...nextConversation,
                                unreadCount: nextConversation.unreadCount ?? existing?.unreadCount ?? 0,
                            };
                        }),
                        state.selectedConversationId
                    ),
                })),

            upsertConversation: (conversation) =>
                set((state) => {
                    const nextConversation = normalizeConversation(conversation);
                    const exists = state.conversations.some(
                        (item) => item._id === nextConversation._id
                    );

                    const nextConversations = exists
                        ? state.conversations.map((item) =>
                            item._id === nextConversation._id ? nextConversation : item
                        )
                        : [nextConversation, ...state.conversations];

                    return {
                        conversations: sortConversations(nextConversations, state.selectedConversationId),
                    };
                }),

            incrementUnread: (conversationId) =>
                set((state) => ({
                    conversations: sortConversations(
                        state.conversations.map((conversation) =>
                            conversation._id === conversationId
                                ? {
                                    ...conversation,
                                    unreadCount: (conversation.unreadCount ?? 0) + 1,
                                }
                                : conversation
                        ),
                        state.selectedConversationId
                    ),
                })),

            clearUnread: (conversationId) =>
                set((state) => ({
                    conversations: sortConversations(
                        state.conversations.map((conversation) =>
                            conversation._id === conversationId
                                ? { ...conversation, unreadCount: 0 }
                                : conversation
                        ),
                        state.selectedConversationId
                    ),
                })),

            setMessages: (conversationId, messages, mode = "replace") =>
                set((state) => {
                    const nextMessages = messages.map(normalizeChatMessage);
                    const currentMessages = state.messagesByConversation[conversationId] ?? [];

                    return {
                        messagesByConversation: {
                            ...state.messagesByConversation,
                            [conversationId]: upsertMessages(currentMessages, nextMessages, mode),
                        },
                    };
                }),

            addMessage: (conversationId, message) =>
                set((state) => {
                    const nextMessage = normalizeChatMessage(message);
                    const currentMessages = state.messagesByConversation[conversationId] ?? [];

                    if (currentMessages.some((item) => item._id === nextMessage._id)) {
                        return {};
                    }

                    return {
                        messagesByConversation: {
                            ...state.messagesByConversation,
                            [conversationId]: [nextMessage, ...currentMessages],
                        },
                        conversations: sortConversations(
                            syncConversationPreview(
                                state.conversations,
                                conversationId,
                                nextMessage,
                                {
                                    selectedConversationId: state.selectedConversationId,
                                    currentUserId: state.currentUserId,
                                    incrementUnread: false,
                                }
                            ),
                            state.selectedConversationId
                        ),
                    };
                }),

            addOptimisticMessage: (conversationId, message) =>
                set((state) => {
                    const nextMessage = normalizeChatMessage({
                        ...message,
                        isTemp: true,
                        status: message.status ?? "pending",
                    });
                    const currentMessages = state.messagesByConversation[conversationId] ?? [];

                    if (currentMessages.some((item) => item._id === nextMessage._id)) {
                        return {};
                    }

                    return {
                        messagesByConversation: {
                            ...state.messagesByConversation,
                            [conversationId]: [nextMessage, ...currentMessages],
                        },
                        conversations: sortConversations(
                            syncConversationPreview(
                                state.conversations,
                                conversationId,
                                nextMessage,
                                {
                                    selectedConversationId: state.selectedConversationId,
                                    currentUserId: state.currentUserId,
                                    incrementUnread: false,
                                }
                            ),
                            state.selectedConversationId
                        ),
                    };
                }),

            receiveMessage: (message) =>
                set((state) => {
                    const nextMessage = normalizeChatMessage(message);
                    const conversationId = nextMessage.conversationId;
                    const loadedMessages = state.messagesByConversation[conversationId];
                    const shouldStoreMessage =
                        Boolean(loadedMessages) || state.selectedConversationId === conversationId;

                    const nextConversations = syncConversationPreview(
                        state.conversations,
                        conversationId,
                        nextMessage,
                        {
                            selectedConversationId: state.selectedConversationId,
                            currentUserId: state.currentUserId,
                            incrementUnread: true,
                        }
                    );

                    if (!shouldStoreMessage) {
                        return { conversations: sortConversations(nextConversations, state.selectedConversationId) };
                    }

                    const currentMessages = loadedMessages ?? [];
                    const exists = currentMessages.some((item) => item._id === nextMessage._id);

                    const tempMatchIndex =
                        !exists && nextMessage.sender._id === state.currentUserId
                            ? currentMessages.findIndex(
                                (item) =>
                                    (item.isTemp || isTempMessageId(item._id)) &&
                                    item.content === nextMessage.content &&
                                    item.messageType === nextMessage.messageType
                            )
                            : -1;

                    const nextMessages = exists
                        ? currentMessages.map((item) =>
                            item._id === nextMessage._id ? nextMessage : item
                        )
                        : tempMatchIndex >= 0
                            ? currentMessages.map((item, index) =>
                                index === tempMatchIndex ? nextMessage : item
                            )
                            : [nextMessage, ...currentMessages];

                    return {
                        conversations: sortConversations(nextConversations, state.selectedConversationId),
                        messagesByConversation: {
                            ...state.messagesByConversation,
                            [conversationId]: nextMessages,
                        },
                    };
                }),

            replaceTempMessage: (conversationId, tempId, message) =>
                set((state) => {
                    const nextMessage = normalizeChatMessage(message);
                    const currentMessages = state.messagesByConversation[conversationId] ?? [];

                    return {
                        messagesByConversation: {
                            ...state.messagesByConversation,
                            [conversationId]: currentMessages.map((item) =>
                                item._id === tempId ? nextMessage : item
                            ),
                        },
                        conversations: sortConversations(
                            syncConversationPreview(
                                state.conversations,
                                conversationId,
                                nextMessage,
                                {
                                    selectedConversationId: state.selectedConversationId,
                                    currentUserId: state.currentUserId,
                                    incrementUnread: false,
                                }
                            ),
                            state.selectedConversationId
                        ),
                    };
                }),

            clearMessages: (conversationId) =>
                set((state) => {
                    const nextMessagesByConversation = { ...state.messagesByConversation };
                    delete nextMessagesByConversation[conversationId];

                    return {
                        messagesByConversation: nextMessagesByConversation,
                    };
                }),

            removeMessage: (conversationId, messageId) =>
                set((state) => {
                    const currentMessages = state.messagesByConversation[conversationId] ?? [];

                    return {
                        messagesByConversation: {
                            ...state.messagesByConversation,
                            [conversationId]: currentMessages.filter((item) => item._id !== messageId),
                        },
                    };
                }),

            updateMessageStatus: (conversationId, messageId, status) =>
                set((state) => {
                    const currentMessages = state.messagesByConversation[conversationId] ?? [];

                    return {
                        messagesByConversation: {
                            ...state.messagesByConversation,
                            [conversationId]: currentMessages.map((item) =>
                                item._id === messageId ? withStatus(item, status) : item
                            ),
                        },
                    };
                }),

            markMessageSeen: (messageId, userId) =>
                set((state) => {
                    const nextMessagesByConversation = Object.fromEntries(
                        Object.entries(state.messagesByConversation).map(([conversationId, messages]) => {
                            const nextMessages = messages.map((item) => {
                                if (item._id !== messageId) {
                                    return item;
                                }

                                if (item.sender._id !== state.currentUserId || userId === state.currentUserId) {
                                    return item;
                                }

                                return withStatus(item, "seen");
                            });

                            return [conversationId, nextMessages];
                        })
                    ) as Record<string, ChatMessage[]>;

                    return {
                        messagesByConversation: nextMessagesByConversation,
                    };
                }),

            setTypingUser: (conversationId, user) =>
                set((state) => {
                    const currentUsers = state.typingUsersByConversation[conversationId] ?? {};

                    return {
                        typingUsersByConversation: {
                            ...state.typingUsersByConversation,
                            [conversationId]: {
                                ...currentUsers,
                                [user._id]: normalizeParticipant(user),
                            },
                        },
                    };
                }),

            removeTypingUser: (conversationId, userId) =>
                set((state) => {
                    const currentUsers = state.typingUsersByConversation[conversationId];

                    if (!currentUsers || !currentUsers[userId]) {
                        return {};
                    }

                    const nextUsers = { ...currentUsers };
                    delete nextUsers[userId];

                    return {
                        typingUsersByConversation: {
                            ...state.typingUsersByConversation,
                            [conversationId]: nextUsers,
                        },
                    };
                }),

            clearTypingUsers: (conversationId) =>
                set((state) => {
                    if (!state.typingUsersByConversation[conversationId]) {
                        return {};
                    }

                    const nextTypingUsersByConversation = { ...state.typingUsersByConversation };
                    delete nextTypingUsersByConversation[conversationId];

                    return {
                        typingUsersByConversation: nextTypingUsersByConversation,
                    };
                }),

            setHasMore: (conversationId, hasMore) =>
                set((state) => ({
                    hasMoreByConversation: {
                        ...state.hasMoreByConversation,
                        [conversationId]: hasMore,
                    },
                })),

            resetChatSession: () => set(() => ({ ...initialState })),
        }),
        {
            name: "mobile-chat-store",
            storage: createJSONStorage(() => AsyncStorage),
            partialize: (state) => ({
                conversations: state.conversations,
            }),
            version: 1,
        }
    )
);

export const chatSelectors = {
    conversations: (state: ChatStoreState) => state.conversations,
    selectedConversationId: (state: ChatStoreState) => state.selectedConversationId,
    currentUserId: (state: ChatStoreState) => state.currentUserId,
    conversationById:
        (conversationId: string) =>
            (state: ChatStoreState) =>
                state.conversations.find((conversation) => conversation._id === conversationId) ?? null,
    messagesByConversationId:
        (conversationId: string) =>
            (state: ChatStoreState) =>
                state.messagesByConversation[conversationId] ?? EMPTY_MESSAGE_LIST,
    typingUsersByConversationId:
        (conversationId: string) =>
            (state: ChatStoreState) =>
                state.typingUsersByConversation[conversationId] ?? EMPTY_TYPING_USER_MAP,
};

export const chatStoreUtils = {
    toStringId,
    normalizeParticipant,
    normalizeChatMessage,
};