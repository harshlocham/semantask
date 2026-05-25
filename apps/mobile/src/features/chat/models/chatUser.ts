import type { ChatConversation, ChatParticipant } from "@/features/chat/store/chatStore";

export type ChatUser = {
    _id: string;
    name: string;
    avatar: string | null;
    lastSeen: string | null;
};

export type ChatUserIdentity = ChatUser & {
    online: boolean;
};

export function toChatUser(participant: ChatParticipant | null | undefined): ChatUser | null {
    if (!participant || !participant._id) {
        return null;
    }

    return {
        _id: participant._id,
        name: participant.name || participant.username || "Unknown",
        avatar: participant.profilePicture ?? null,
        lastSeen: typeof participant.lastSeen === "string" ? participant.lastSeen : null,
    };
}

export function getDirectConversationUser(
    conversation: ChatConversation | null,
    currentUserId?: string | null
): ChatUser | null {
    if (!conversation || conversation.isGroup) {
        return null;
    }

    const participant = conversation.participants.find((item) => item._id !== currentUserId);
    return toChatUser(participant);
}

export function toChatUserIdentity(
    user: ChatUser | null,
    onlineUsers: Record<string, boolean>,
    lastSeenByUser: Record<string, string | null | undefined>,
    fallbackOnline?: boolean
): ChatUserIdentity | null {
    if (!user) {
        return null;
    }

    return {
        ...user,
        online: Boolean(onlineUsers[user._id] || fallbackOnline),
        lastSeen: lastSeenByUser[user._id] ?? user.lastSeen ?? null,
    };
}
