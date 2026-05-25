import { StackScreenProps } from "@react-navigation/stack";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ChatsStackParamList } from "@/app/navigation/types";
import PresenceDot from "@/components/common/PresenceDot";
import GroupedMessageList from "@/features/chat/components/GroupedMessageList";
import MessageInput from "@/features/chat/components/MessageInput";
import TypingIndicator from "@/features/chat/components/TypingIndicator";
import { useAuthStore } from "@/features/auth/store/authStore";
import type { ChatMessage, ChatParticipant } from "@/features/chat/store/chatStore";
import { chatSelectors, useChatStore } from "@/features/chat/store/chatStore";
import { useMessages } from "@/features/chat/hooks/useMessages";
import { getDirectConversationUser, toChatUserIdentity } from "@/features/chat/models/chatUser";
import { usePresenceStore } from "@/store/presence-store";

const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_TYPING_USERS: Record<string, ChatParticipant> = {};
type ChatScreenProps = StackScreenProps<ChatsStackParamList, "ChatRoom">;

const getUserId = (user: unknown): string | null => {
    if (!user || typeof user !== "object") {
        return null;
    }

    const value = user as { id?: unknown; _id?: unknown };

    if (typeof value.id === "string") {
        return value.id;
    }

    if (typeof value._id === "string") {
        return value._id;
    }

    return null;
};

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

export default function ChatScreen({ route }: ChatScreenProps) {
    const conversationId = route.params.conversationId;
    const setSelectedConversationId = useChatStore((state) => state.setSelectedConversationId);
    const conversation = useChatStore((state) =>
        conversationId
            ? state.conversations.find((item) => item._id === conversationId) ?? null
            : null
    );
    const onlineUsers = usePresenceStore((state) => state.onlineUsers);
    const lastSeenByUser = usePresenceStore((state) => state.lastSeenByUser);
    const storeMessages = useChatStore((state) =>
        conversationId ? state.messagesByConversation[conversationId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES
    );
    const typingUsersMap = useChatStore(chatSelectors.typingUsersByConversationId(conversationId));
    const typingUsers = useMemo(() => Object.values(typingUsersMap ?? EMPTY_TYPING_USERS), [typingUsersMap]);
    const setMessages = useChatStore((state) => state.setMessages);
    const clearMessages = useChatStore((state) => state.clearMessages);
    const setHasMore = useChatStore((state) => state.setHasMore);
    const clearUnread = useChatStore((state) => state.clearUnread);
    const user = useAuthStore((state) => state.user);
    const currentUserId = getUserId(user);

    useEffect(() => {
        if (conversationId) {
            setSelectedConversationId(conversationId);
        }
    }, [conversationId, setSelectedConversationId]);

    const headerIdentity = useMemo(() => {
        if (!conversation) {
            return {
                title: "Loading user...",
                avatar: null as string | null,
                online: false,
                subtitle: "Loading status...",
                isLoading: true,
            };
        }

        if (!conversation.isGroup) {
            const directParticipant = conversation.participants.find((participant) => participant._id !== currentUserId);
            const directUser = getDirectConversationUser(conversation, currentUserId);
            const directIdentity = toChatUserIdentity(
                directUser,
                onlineUsers,
                lastSeenByUser,
                Boolean(directParticipant?.isOnline)
            );

            if (!directIdentity) {
                return {
                    title: "Loading user...",
                    avatar: null as string | null,
                    online: false,
                    subtitle: "Loading status...",
                    isLoading: true,
                };
            }

            return {
                title: directIdentity.name,
                avatar: directIdentity.avatar,
                online: directIdentity.online,
                subtitle: directIdentity.online ? "Online" : formatLastSeen(directIdentity.lastSeen),
                isLoading: false,
            };
        }

        const participants = conversation.participants.filter((participant) => participant._id !== currentUserId);
        const activeParticipants = participants.filter((participant) => {
            return Boolean(onlineUsers[participant._id] || participant.isOnline);
        });

        const latestLastSeen = participants.reduce<string | null>((latest, participant) => {
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

        const online = activeParticipants.length > 0;

        return {
            title: conversation.groupName ?? conversation.name ?? "Group",
            avatar: conversation.image ?? null,
            online,
            subtitle: online ? `${activeParticipants.length} online` : formatLastSeen(latestLastSeen),
            isLoading: false,
        };
    }, [conversation, currentUserId, lastSeenByUser, onlineUsers]);

    const {
        data,
        isLoading,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useMessages(conversationId);

    const queryMessages = useMemo(
        () => data?.pages.flatMap((page) => page.messages) ?? EMPTY_MESSAGES,
        [data?.pages]
    );

    const messagesMatch = useMemo(() => {
        if (storeMessages.length !== queryMessages.length) {
            return false;
        }

        return storeMessages.every((message, index) => message._id === queryMessages[index]?._id);
    }, [queryMessages, storeMessages]);

    const canHydrateFromQuery = useMemo(() => {
        if (storeMessages.length === 0) {
            return true;
        }

        const queryIds = new Set(queryMessages.map((message) => message._id));

        // If store already has messages not present in the current query snapshot,
        // keep them to avoid dropping freshly sent/socket-delivered items.
        const hasStoreOnlyMessages = storeMessages.some((message) => !queryIds.has(message._id));

        return !hasStoreOnlyMessages;
    }, [queryMessages, storeMessages]);

    useEffect(() => {
        if (!conversationId || !queryMessages) {
            return;
        }

        if (!messagesMatch && canHydrateFromQuery) {
            setMessages(conversationId, queryMessages, "replace");
        }

        clearUnread(conversationId);
        setHasMore(conversationId, Boolean(hasNextPage));
    }, [canHydrateFromQuery, clearUnread, conversationId, hasNextPage, messagesMatch, queryMessages, setHasMore, setMessages]);

    useEffect(() => {
        if (!conversationId) {
            return;
        }

        return () => {
            clearMessages(conversationId);
        };
    }, [clearMessages, conversationId]);

    if (!conversationId) {
        return (
            <SafeAreaView className="flex-1 items-center justify-center px-6 bg-white dark:bg-slate-950">
                <Text className="text-center text-slate-500 dark:text-slate-400">
                    Select a conversation to start chatting.
                </Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView className="flex-1 bg-white dark:bg-slate-950">
            <KeyboardAvoidingView
                className="flex-1"
                behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
                <View className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                    <View className="flex-row items-center gap-2">
                        <View className="relative h-9 w-9 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800">
                            {headerIdentity.avatar ? (
                                <Image
                                    source={{ uri: headerIdentity.avatar }}
                                    className="h-full w-full rounded-full"
                                    resizeMode="cover"
                                />
                            ) : headerIdentity.isLoading ? (
                                <ActivityIndicator size="small" />
                            ) : (
                                <Text className="text-sm font-semibold text-slate-700 dark:text-slate-100">
                                    {headerIdentity.title.trim().charAt(0).toUpperCase() || "C"}
                                </Text>
                            )}
                            <View className="absolute -right-0.5 -top-0.5">
                                {headerIdentity.isLoading ? <ActivityIndicator size="small" /> : <PresenceDot online={headerIdentity.online} />}
                            </View>
                        </View>

                        <View className="flex-1">
                            <Text className="text-lg font-semibold text-slate-900 dark:text-slate-100">{headerIdentity.title}</Text>
                            <Text className="text-sm text-slate-500 dark:text-slate-400">{headerIdentity.subtitle}</Text>
                        </View>
                    </View>
                </View>

                {isLoading ? (
                    <View className="flex-1 items-center justify-center">
                        <ActivityIndicator />
                    </View>
                ) : (
                    <View className="flex-1">
                        <GroupedMessageList
                            messages={storeMessages}
                            currentUserId={currentUserId}
                            hasNextPage={hasNextPage}
                            isFetchingNextPage={isFetchingNextPage}
                            onFetchNextPage={() => {
                                void fetchNextPage();
                            }}
                            emptyLabel="No messages yet."
                        />

                        <TypingIndicator typingUsers={typingUsers} currentUserId={currentUserId} />
                    </View>
                )}

                <MessageInput conversationId={conversationId} />
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}