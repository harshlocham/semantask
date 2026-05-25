import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";

import PresenceDot from "@/components/common/PresenceDot";
import { usePresenceStore } from "@/store/presence-store";
import type { ChatConversation } from "@/features/chat/store/chatStore";
import { getDirectConversationUser, toChatUserIdentity } from "@/features/chat/models/chatUser";

type ConversationListItemProps = {
    conversation: ChatConversation;
    currentUserId?: string | null;
    onPress: (conversationId: string) => void;
};

const previewByType: Record<string, string> = {
    image: "Photo",
    video: "Video",
    audio: "Audio",
    voice: "Voice message",
    file: "File",
    system: "System update",
};

function formatConversationTime(value?: string) {
    if (!value) {
        return "";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
    }).format(date);
}

function getConversationName(conversation: ChatConversation, directUserName?: string | null) {
    if (conversation.isGroup) {
        return conversation.groupName || conversation.name || "Group";
    }

    return directUserName || conversation.name || "Loading user...";
}

function getConversationAvatar(conversation: ChatConversation, directUserAvatar?: string | null) {
    if (conversation.image) {
        return conversation.image;
    }

    return directUserAvatar ?? null;
}

function getPreviewText(conversation: ChatConversation, currentUserId?: string | null) {
    const last = conversation.lastMessage;

    if (!last) {
        return "Say hi to start this conversation";
    }

    const raw = previewByType[last.messageType] ?? last.content;
    const senderPrefix = last.sender._id === currentUserId ? "You: " : "";
    const combined = `${senderPrefix}${raw}`;

    return combined.length > 42 ? `${combined.slice(0, 42)}...` : combined;
}

function formatLastSeen(value?: string | null) {
    if (!value) {
        return "Offline";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "Offline";
    }

    const diffMinutes = Math.max(1, Math.floor((Date.now() - date.getTime()) / 60000));

    if (diffMinutes < 60) {
        return `last seen ${diffMinutes} min ago`;
    }

    const diffHours = Math.floor(diffMinutes / 60);

    if (diffHours < 24) {
        return `last seen ${diffHours} hr ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    return `last seen ${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

export default function ConversationListItem({
    conversation,
    currentUserId,
    onPress,
}: ConversationListItemProps) {
    const conversationId = conversation._id;
    const preview = getPreviewText(conversation, currentUserId);
    const timeLabel = formatConversationTime(conversation.updatedAt || conversation.createdAt);
    const unreadCount = conversation.unreadCount ?? 0;
    const onlineUsers = usePresenceStore((state) => state.onlineUsers);
    const lastSeenByUser = usePresenceStore((state) => state.lastSeenByUser);
    const directParticipant = conversation.participants.find((participant) => participant._id !== currentUserId);
    const directUser = getDirectConversationUser(conversation, currentUserId);
    const directIdentity = toChatUserIdentity(
        directUser,
        onlineUsers,
        lastSeenByUser,
        Boolean(directParticipant?.isOnline)
    );

    const avatarUri = getConversationAvatar(conversation, directIdentity?.avatar ?? null);
    const title = getConversationName(conversation, directIdentity?.name ?? null);
    const initial = title.trim().charAt(0).toUpperCase() || "C";
    const isDirectIdentityLoading = !conversation.isGroup && !directIdentity;

    const otherParticipants = conversation.participants.filter((participant) => participant._id !== currentUserId);

    const onlineCount = otherParticipants.filter((participant) => {
        return Boolean(onlineUsers[participant._id] || participant.isOnline);
    }).length;

    const isOnline = conversation.isGroup ? onlineCount > 0 : Boolean(directIdentity?.online);

    const latestLastSeen = otherParticipants.reduce<string | null>((latest, participant) => {
        const candidate = lastSeenByUser[participant._id] ?? participant.lastSeen ?? null;

        if (!candidate) {
            return latest;
        }

        if (!latest) {
            return candidate;
        }

        const candidateTime = new Date(candidate).getTime();
        const latestTime = new Date(latest).getTime();

        return Number.isNaN(candidateTime) || candidateTime <= latestTime ? latest : candidate;
    }, null);

    const presenceLabel = conversation.isGroup
        ? isOnline
            ? `${onlineCount} online`
            : formatLastSeen(latestLastSeen)
        : isDirectIdentityLoading
            ? "Loading status..."
            : isOnline
                ? "Online"
                : formatLastSeen(directIdentity?.lastSeen ?? latestLastSeen);

    return (
        <Pressable
            className="flex-row items-center gap-3 px-4 py-3 active:opacity-80"
            onPress={() => onPress(conversationId)}
        >
            <View className="relative h-12 w-12 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                {avatarUri ? (
                    <Image
                        source={{ uri: avatarUri }}
                        className="h-full w-full"
                        resizeMode="cover"
                    />
                ) : (
                    <View className="flex-1 items-center justify-center">
                        <Text className="text-sm font-semibold text-slate-700 dark:text-slate-100">{initial}</Text>
                    </View>
                )}
                <View className="absolute -right-0.5 -top-0.5">
                    {isDirectIdentityLoading ? <ActivityIndicator size="small" /> : <PresenceDot online={isOnline} />}
                </View>
            </View>

            <View className="flex-1 border-b border-slate-200 pb-3 dark:border-slate-800">
                <View className="mb-1 flex-row items-center justify-between gap-2">
                    <View className="flex-1">
                        <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100" numberOfLines={1}>
                            {title}
                        </Text>
                        <Text className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400" numberOfLines={1}>
                            {presenceLabel}
                        </Text>
                    </View>
                    <Text className="text-xs text-slate-500 dark:text-slate-400">{timeLabel}</Text>
                </View>

                <View className="flex-row items-center justify-between gap-2">
                    <Text className="flex-1 text-xs text-slate-500 dark:text-slate-400" numberOfLines={1}>
                        {preview}
                    </Text>

                    {unreadCount > 0 ? (
                        <View className="rounded-full bg-emerald-600 px-2 py-0.5 dark:bg-emerald-500">
                            <Text className="text-[10px] font-semibold text-white">{unreadCount}</Text>
                        </View>
                    ) : null}
                </View>
            </View>
        </Pressable>
    );
}
