import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuthStore } from "@/features/auth/store/authStore";
import { useChatStore } from "@/features/chat/store/chatStore";
import { useSocket } from "@/providers/socket-provider";
import { ChatSocketEvents } from "@/features/chat/socket/chatSocket";
import { sendChatMessage } from "@/features/chat/api/chatApi";

type MessageInputProps = {
    conversationId: string;
};

const SEND_TIMEOUT_MS = 12_000;
const TYPING_STOP_DELAY_MS = 700;

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

const getUsername = (user: unknown): string => {
    if (!user || typeof user !== "object") {
        return "You";
    }

    const value = user as { username?: unknown; name?: unknown; email?: unknown };

    if (typeof value.username === "string" && value.username.trim()) {
        return value.username;
    }

    if (typeof value.name === "string" && value.name.trim()) {
        return value.name;
    }

    if (typeof value.email === "string" && value.email.trim()) {
        return value.email;
    }

    return "You";
};

const getParticipantId = (participant: unknown): string | null => {
    if (!participant || typeof participant !== "object") {
        return null;
    }

    const value = participant as { _id?: unknown; id?: unknown; userId?: unknown };

    if (typeof value._id === "string" && value._id.trim()) {
        return value._id;
    }

    if (typeof value.id === "string" && value.id.trim()) {
        return value.id;
    }

    if (typeof value.userId === "string" && value.userId.trim()) {
        return value.userId;
    }

    return null;
};

export default function MessageInput({ conversationId }: MessageInputProps) {
    const [text, setText] = useState("");
    const insets = useSafeAreaInsets();
    const conversations = useChatStore((state) => state.conversations);
    const upsertConversation = useChatStore((state) => state.upsertConversation);
    const addOptimisticMessage = useChatStore((state) => state.addOptimisticMessage);
    const updateMessageStatus = useChatStore((state) => state.updateMessageStatus);
    const replaceTempMessage = useChatStore((state) => state.replaceTempMessage);
    const removeMessage = useChatStore((state) => state.removeMessage);
    const user = useAuthStore((state) => state.user);
    const { emit, connected } = useSocket();
    const typingStartedRef = useRef(false);
    const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const emitTypingStop = useCallback(() => {
        if (!typingStartedRef.current) {
            return;
        }

        typingStartedRef.current = false;

        if (typingStopTimerRef.current) {
            clearTimeout(typingStopTimerRef.current);
            typingStopTimerRef.current = null;
        }

        if (connected) {
            emit(ChatSocketEvents.TYPING_STOP, {
                conversationId,
                userId: getUserId(user),
            });
        }
    }, [connected, conversationId, emit, user]);

    const scheduleTypingStop = useCallback(() => {
        if (typingStopTimerRef.current) {
            clearTimeout(typingStopTimerRef.current);
        }

        typingStopTimerRef.current = setTimeout(() => {
            emitTypingStop();
        }, TYPING_STOP_DELAY_MS);
    }, [emitTypingStop]);

    const handleChangeText = useCallback((nextText: string) => {
        setText(nextText);

        if (!connected) {
            return;
        }

        const trimmed = nextText.trim();

        if (trimmed.length > 0 && !typingStartedRef.current) {
            typingStartedRef.current = true;
            const displayName = getUsername(user);
            emit(ChatSocketEvents.TYPING_START, {
                conversationId,
                userId: getUserId(user),
                name: displayName,
                username: displayName,
            });
        }

        if (trimmed.length === 0) {
            scheduleTypingStop();
            return;
        }

        scheduleTypingStop();
    }, [connected, conversationId, emit, getUsername, scheduleTypingStop, user]);

    useEffect(() => {
        return () => {
            if (typingStopTimerRef.current) {
                clearTimeout(typingStopTimerRef.current);
            }

            emitTypingStop();
        };
    }, [emitTypingStop]);

    const handleSend = async () => {
        const content = text.trim();

        if (!content) {
            return;
        }

        const senderId = getUserId(user);

        if (!senderId) {
            return;
        }

        emitTypingStop();
        setText("");

        const createdAt = new Date().toISOString();
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        addOptimisticMessage(conversationId, {
            _id: tempId,
            conversationId,
            content,
            messageType: "text",
            sender: {
                _id: senderId,
                name: getUsername(user),
                username: getUsername(user),
            },
            createdAt,
            updatedAt: createdAt,
            status: "pending",
            delivered: false,
            seen: false,
            isTemp: true,
        });

        const nextConversation = conversations.find((item) => item._id === conversationId);

        if (nextConversation) {
            upsertConversation({
                ...nextConversation,
                lastMessage: {
                    _id: tempId,
                    conversationId,
                    content,
                    messageType: "text",
                    sender: {
                        _id: senderId,
                        name: getUsername(user),
                        username: getUsername(user),
                    },
                    createdAt,
                    updatedAt: createdAt,
                    status: "pending",
                    delivered: false,
                    seen: false,
                    isTemp: true,
                },
                updatedAt: createdAt,
            });
        }

        const rollback = () => {
            removeMessage(conversationId, tempId);
        };

        const timeout = setTimeout(() => {
            rollback();
        }, SEND_TIMEOUT_MS);

        try {
            const savedMessage = await sendChatMessage({
                conversationId,
                content,
                messageType: "text",
            });

            replaceTempMessage(conversationId, tempId, {
                ...savedMessage,
                status: "sent",
                delivered: Boolean(savedMessage.delivered),
                seen: Boolean(savedMessage.seen),
            });

            const participants = nextConversation?.participants ?? [];
            const conversationMembers = Array.from(
                new Set(
                    participants
                        .map((participant) => getParticipantId(participant))
                        .filter((id): id is string => typeof id === "string" && id.length > 0)
                        .concat(senderId)
                )
            );

            if (connected) {
                emit(
                    ChatSocketEvents.MESSAGE_SEND,
                    { data: savedMessage, conversationMembers },
                    (ack?: { ok?: boolean }) => {
                        if (ack?.ok === false) {
                            console.warn("message:send socket ack failed", {
                                conversationId,
                                messageId: savedMessage._id,
                            });
                        }
                    }
                );
            }
        } catch {
            rollback();
        } finally {
            clearTimeout(timeout);
        }
    };

    return (
        <View
            className="border-t border-slate-200 bg-white px-3 pt-3 dark:border-slate-800 dark:bg-slate-950"
            style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
            <View className="flex-row items-end gap-2 rounded-3xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <Pressable className="h-9 w-9 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800">
                    <Ionicons name="add" size={18} color="#64748b" />
                </Pressable>
                <TextInput
                    className="min-h-[40px] flex-1 py-1 text-[15px] text-slate-900 dark:text-slate-100"
                    placeholder="Message"
                    placeholderTextColor="#94a3b8"
                    value={text}
                    onChangeText={handleChangeText}
                    multiline
                />
                <Pressable
                    className={`h-9 w-9 items-center justify-center rounded-full ${text.trim() ? "bg-emerald-600" : "bg-slate-200 dark:bg-slate-800"}`}
                    onPress={handleSend}
                    disabled={!text.trim()}
                >
                    <Ionicons
                        name="send"
                        size={16}
                        color={text.trim() ? "#ffffff" : "#64748b"}
                    />
                </Pressable>
            </View>
        </View>
    );
}
