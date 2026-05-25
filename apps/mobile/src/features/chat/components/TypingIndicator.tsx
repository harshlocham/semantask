import { Text, View } from "react-native";

import type { ChatParticipant } from "@/features/chat/store/chatStore";

type TypingIndicatorProps = {
    typingUsers: ChatParticipant[];
    currentUserId: string | null;
};

function buildLabel(users: ChatParticipant[]) {
    if (users.length === 0) {
        return "";
    }

    const names = users
        .map((user) => user.name || user.username || user._id || "User")
        .filter(Boolean);

    if (names.length === 1) {
        return `${names[0]} is typing...`;
    }

    if (names.length === 2) {
        return `${names[0]} and ${names[1]} are typing...`;
    }

    return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length - 2 === 1 ? "" : "s"} are typing...`;
}

export default function TypingIndicator({ typingUsers, currentUserId }: TypingIndicatorProps) {
    const visibleUsers = typingUsers.filter((user) => user._id !== currentUserId);

    if (visibleUsers.length === 0) {
        return null;
    }

    return (
        <View className="px-4 pb-2 pt-1">
            <View className="self-start rounded-full border border-slate-200 bg-slate-100 px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <Text className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {buildLabel(visibleUsers)}
                </Text>
            </View>
        </View>
    );
}