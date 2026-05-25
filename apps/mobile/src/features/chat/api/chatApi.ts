import api from "@/features/auth/api/client";
import {
    chatStoreUtils,
    type ChatConversation,
    type ChatMessage,
    type ChatMessageInput,
    type ChatParticipant,
} from "@/features/chat/store/chatStore";

type MessageResponse = ChatMessageInput[];

const normalizeParticipant = (participant: unknown): ChatParticipant => {
    if (!participant || typeof participant !== "object") {
        return {
            _id: "",
            name: "",
            username: "",
        };
    }

    const value = participant as {
        _id?: unknown;
        name?: unknown;
        username?: unknown;
        profilePicture?: unknown;
        isOnline?: unknown;
        lastSeen?: unknown;
    };

    const lastSeen =
        typeof value.lastSeen === "string"
            ? value.lastSeen
            : value.lastSeen instanceof Date
                ? value.lastSeen.toISOString()
                : null;

    const normalizedName =
        typeof value.name === "string" && value.name.trim()
            ? value.name
            : typeof value.username === "string" && value.username.trim()
                ? value.username
                : "";

    return {
        _id: chatStoreUtils.toStringId(value._id),
        name: normalizedName,
        username: typeof value.username === "string" ? value.username : "",
        profilePicture: typeof value.profilePicture === "string" ? value.profilePicture : null,
        isOnline: Boolean(value.isOnline),
        lastSeen,
    };
};

export const normalizeConversation = (conversation: unknown): ChatConversation => {
    const value = conversation as Record<string, unknown>;

    return {
        _id: chatStoreUtils.toStringId(value._id),
        type: value.type === "group" ? "group" : "direct",
        participants: Array.isArray(value.participants)
            ? value.participants.map((participant) => normalizeParticipant(participant))
            : [],
        name: typeof value.name === "string" ? value.name : undefined,
        image: typeof value.image === "string" ? value.image : undefined,
        isGroup: Boolean(value.isGroup),
        groupName: typeof value.groupName === "string" ? value.groupName : undefined,
        admin: typeof value.admin === "string" ? value.admin : undefined,
        lastMessage: value.lastMessage
            ? chatStoreUtils.normalizeChatMessage(value.lastMessage as ChatMessageInput)
            : undefined,
        unreadCount:
            typeof value.unreadCount === "number" ? value.unreadCount : undefined,
        createdAt: typeof value.createdAt === "string" ? value.createdAt : undefined,
        updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
    };
};

export async function fetchConversations() {
    const res = await api.get("/conversations");
    const payload = Array.isArray(res.data) ? res.data : [];

    return payload.map(normalizeConversation);
}

export async function fetchConversationMessages(conversationId: string, cursor?: string) {
    const res = await api.get<MessageResponse>("/messages", {
        params: {
            conversationId,
            cursor,
        },
    });

    const payload = Array.isArray(res.data) ? res.data : [];

    return payload.map((message) => chatStoreUtils.normalizeChatMessage(message));
}

export async function sendChatMessage(payload: {
    conversationId: string;
    content: string;
    messageType?: ChatMessage["messageType"];
}) {
    const res = await api.post<ChatMessageInput>("/messages", {
        conversationId: payload.conversationId,
        content: payload.content,
        messageType: payload.messageType ?? "text",
    });

    return chatStoreUtils.normalizeChatMessage(res.data);
}