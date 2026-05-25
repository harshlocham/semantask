import { useInfiniteQuery } from "@tanstack/react-query";

import { fetchConversationMessages } from "../api/chatApi";
import type { ChatMessage } from "../store/chatStore";

const PAGE_SIZE = 20;

export type ConversationMessagesPage = {
    messages: ChatMessage[];
    nextCursor?: string;
};

export const conversationMessagesQueryKey = (conversationId: string) => ["chat", "messages", conversationId] as const;

export const useMessages = (conversationId: string) => {
    return useInfiniteQuery({
        queryKey: conversationMessagesQueryKey(conversationId),
        queryFn: async ({ pageParam }: { pageParam?: string }) => {
            const messages = await fetchConversationMessages(conversationId, pageParam);
            const nextCursor = messages.length === PAGE_SIZE ? messages[messages.length - 1]?._id : undefined;

            return {
                messages,
                nextCursor,
            } satisfies ConversationMessagesPage;
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        initialPageParam: undefined,
        enabled: Boolean(conversationId),
    });
};