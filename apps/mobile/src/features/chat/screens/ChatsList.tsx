import { CompositeNavigationProp } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { fetchConversations } from "@/features/chat/api/chatApi";
import ConversationListItem from "@/features/chat/components/ConversationListItem";
import { useChatStore } from "@/features/chat/store/chatStore";
import type {
    RootStackParamList,
    TabsParamList,
    ChatsStackParamList,
} from "@/app/navigation/types";

type ChatsListNavigationProp = CompositeNavigationProp<
    StackNavigationProp<ChatsStackParamList, "ChatsList">,
    CompositeNavigationProp<
        BottomTabNavigationProp<TabsParamList, "ChatsTab">,
        StackNavigationProp<RootStackParamList>
    >
>;

type ChatsListProps = {
    navigation: ChatsListNavigationProp;
};

export default function ChatsList({ navigation }: ChatsListProps) {
    const currentUserId = useChatStore((state) => state.currentUserId);
    const conversations = useChatStore((state) => state.conversations);
    const setConversations = useChatStore((state) => state.setConversations);
    const setSelectedConversationId = useChatStore((state) => state.setSelectedConversationId);
    const clearUnread = useChatStore((state) => state.clearUnread);

    const {
        data: fetchedConversations = [],
        isLoading,
        isError,
        refetch,
    } = useQuery({
        queryKey: ["chat", "conversations"],
        queryFn: fetchConversations,
        staleTime: 30_000,
    });

    useEffect(() => {
        if (fetchedConversations.length > 0) {
            setConversations(fetchedConversations);
        }
    }, [fetchedConversations, setConversations]);

    const listData = useMemo(() => conversations, [conversations]);

    const handleConversationPress = (conversationId: string) => {
        setSelectedConversationId(conversationId);
        clearUnread(conversationId);
        navigation.navigate("ChatRoom", { conversationId });
    };

    return (
        <SafeAreaView className="flex-1 bg-white dark:bg-slate-950">
            <View className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <Text className="text-2xl font-bold text-slate-900 dark:text-slate-100">Chats</Text>
                <Text className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Recent conversations from your inbox
                </Text>
            </View>

            {isLoading ? (
                <View className="flex-1 items-center justify-center">
                    <ActivityIndicator />
                </View>
            ) : isError ? (
                <View className="flex-1 items-center justify-center px-6">
                    <Text className="mb-3 text-center text-slate-600 dark:text-slate-300">
                        Unable to load conversations right now.
                    </Text>
                    <Text className="text-sm font-semibold text-emerald-600 dark:text-emerald-400" onPress={() => refetch()}>
                        Tap to retry
                    </Text>
                </View>
            ) : (
                <FlatList
                    data={listData}
                    keyExtractor={(item) => item._id}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    initialNumToRender={12}
                    maxToRenderPerBatch={12}
                    windowSize={8}
                    removeClippedSubviews
                    contentContainerStyle={listData.length === 0 ? { flexGrow: 1 } : undefined}
                    renderItem={({ item }) => (
                        <ConversationListItem
                            conversation={item}
                            currentUserId={currentUserId}
                            onPress={handleConversationPress}
                        />
                    )}
                    ListEmptyComponent={
                        <View className="items-center justify-center px-6 py-10">
                            <Text className="text-center text-slate-500 dark:text-slate-400">
                                No conversations yet. Start a new chat.
                            </Text>
                        </View>
                    }
                />
            )}
        </SafeAreaView>
    );
}
