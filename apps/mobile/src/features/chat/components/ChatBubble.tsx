import { Image, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { ChatMessage } from "@/features/chat/store/chatStore";

type ChatBubbleProps = {
    message: ChatMessage;
    isMine: boolean;
    showAvatar?: boolean;
    showSenderName?: boolean;
    showTimestamp?: boolean;
    timestampLabel?: string;
    compactSpacing?: boolean;
};

function getAvatarInitial(name: string) {
    return name.trim().charAt(0).toUpperCase() || "U";
}

export default function ChatBubble({
    message,
    isMine,
    showAvatar = false,
    showSenderName = false,
    showTimestamp = false,
    timestampLabel,
    compactSpacing = false,
}: ChatBubbleProps) {
    const senderName = message.sender.name || message.sender.username || message.sender._id || "Unknown";
    const status = message.status ?? (message.seen ? "seen" : message.delivered ? "delivered" : "sent");
    const showStatus = isMine;
    const isSystem = message.messageType === "system";

    const statusIconName =
        status === "seen"
            ? "checkmark-done"
            : status === "delivered"
                ? "checkmark-done"
                : status === "pending" || status === "queued"
                    ? "time-outline"
                    : status === "failed"
                        ? "alert-circle-outline"
                    : "checkmark";

    const statusColor =
        status === "seen"
            ? "#60a5fa"
            : status === "delivered"
                ? "#cbd5e1"
                : status === "failed"
                    ? "#fca5a5"
                : "#cbd5e1";

    const statusLabel =
        status === "seen"
            ? "Seen"
            : status === "delivered"
                ? "Delivered"
                : status === "pending" || status === "queued"
                    ? "Sending"
                    : status === "failed"
                        ? "Failed"
                        : "Sent";

    if (isSystem) {
        return (
            <View className={`items-center ${compactSpacing ? "mb-1" : "mb-3"}`}>
                <View className="max-w-[85%] rounded-full bg-slate-200 px-3 py-2 dark:bg-slate-800">
                    <Text className="text-center text-xs text-slate-700 dark:text-slate-200">
                        {message.content}
                    </Text>
                </View>

                {showTimestamp && timestampLabel ? (
                    <Text className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                        {timestampLabel}
                    </Text>
                ) : null}
            </View>
        );
    }

    return (
        <View className={`${compactSpacing ? "mb-1" : "mb-3"} ${isMine ? "items-end" : "items-start"}`}>
            <View className={`flex-row items-end gap-2 ${isMine ? "justify-end" : "justify-start"}`}>
                {!isMine && showAvatar ? (
                    <View className="h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                        {message.sender.profilePicture ? (
                            <Image
                                source={{ uri: message.sender.profilePicture }}
                                className="h-full w-full"
                                resizeMode="cover"
                            />
                        ) : (
                            <Text className="text-xs font-semibold text-slate-700 dark:text-slate-100">
                                {getAvatarInitial(senderName)}
                            </Text>
                        )}
                    </View>
                ) : !isMine ? (
                    <View className="w-8" />
                ) : null}

                <View
                    className={`max-w-[82%] rounded-2xl px-4 py-3 ${isMine
                        ? "bg-emerald-600 dark:bg-emerald-500"
                        : "bg-slate-100 dark:bg-slate-800"
                    }`}
                >
                    {!isMine && showSenderName ? (
                    <Text className="mb-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        {senderName}
                    </Text>
                ) : null}

                <Text
                    className={`text-sm leading-5 ${isMine ? "text-white" : "text-slate-800 dark:text-slate-100"
                        }`}
                >
                    {message.content}
                </Text>

                {showStatus ? (
                    <View className="mt-2 flex-row items-center justify-end gap-1">
                        <Text className="text-[10px] text-white/75">
                            {statusLabel}
                        </Text>
                        <Ionicons name={statusIconName as any} size={12} color={statusColor} />
                    </View>
                ) : null}
                </View>
            </View>

            {showTimestamp && timestampLabel ? (
                <Text className={`mt-1 text-[10px] text-slate-500 dark:text-slate-400 ${isMine ? "text-right" : "text-left"}`}>
                    {timestampLabel}
                </Text>
            ) : null}
        </View>
    );
}
