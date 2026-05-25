import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import { ActivityIndicator, Image, Modal, Pressable, Text, View } from "react-native";

import { useSocket } from "@/providers/socket-provider";
import {
    callSelectors,
    useCallStore,
} from "@/features/calls/store/callStore";
import { CallSignalingEvents } from "@/features/calls/types/callSignaling";

function formatLastSeen(value?: string | null) {
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
        month: "short",
        day: "numeric",
    }).format(date);
}

export default function IncomingCallModal() {
    const { emit } = useSocket();
    const incomingCall = useCallStore(callSelectors.incomingCall);
    const actionState = useCallStore(callSelectors.actionState);
    const setActionState = useCallStore((state) => state.setActionState);
    const acceptIncomingCall = useCallStore((state) => state.acceptIncomingCall);
    const rejectIncomingCall = useCallStore((state) => state.rejectIncomingCall);

    const callerInitial = useMemo(() => {
        return incomingCall?.from.name?.trim().charAt(0).toUpperCase() || "C";
    }, [incomingCall?.from.name]);

    const handleReject = () => {
        if (!incomingCall) {
            return;
        }

        setActionState("rejecting");

        emit(CallSignalingEvents.REJECT, {
            callId: incomingCall.callId,
            conversationId: incomingCall.conversationId,
            rejectedAt: new Date().toISOString(),
        });

        rejectIncomingCall();
    };

    const handleAccept = () => {
        if (!incomingCall) {
            return;
        }

        setActionState("accepting");

        emit(CallSignalingEvents.ACCEPT, {
            callId: incomingCall.callId,
            conversationId: incomingCall.conversationId,
            acceptedAt: new Date().toISOString(),
            mediaType: incomingCall.mediaType,
            // Placeholder for future WebRTC SDP answer.
            rtc: {
                answer: null,
            },
        });

        acceptIncomingCall();
    };

    return (
        <Modal
            visible={Boolean(incomingCall)}
            transparent={false}
            animationType="slide"
            statusBarTranslucent
        >
            <View className="flex-1 bg-slate-950 px-6 py-12">
                <View className="flex-1 items-center justify-center">
                    <Text className="text-xs font-semibold uppercase tracking-[2px] text-slate-400">
                        Incoming {incomingCall?.mediaType === "video" ? "Video" : "Audio"} Call
                    </Text>

                    <View className="mt-8 h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-slate-800">
                        {incomingCall?.from.avatar ? (
                            <Image
                                source={{ uri: incomingCall.from.avatar }}
                                className="h-full w-full"
                                resizeMode="cover"
                            />
                        ) : (
                            <Text className="text-3xl font-bold text-white">{callerInitial}</Text>
                        )}
                    </View>

                    <Text className="mt-5 text-3xl font-bold text-white">
                        {incomingCall?.from.name ?? "Unknown caller"}
                    </Text>

                    {incomingCall?.from.lastSeen ? (
                        <Text className="mt-1 text-sm text-slate-400">
                            last seen {formatLastSeen(incomingCall.from.lastSeen)}
                        </Text>
                    ) : null}

                    <Text className="mt-3 text-sm text-slate-400">
                        Preparing signaling channel for WebRTC handshake...
                    </Text>
                </View>

                <View className="mb-6 flex-row items-center justify-center gap-10">
                    <Pressable
                        className="h-16 w-16 items-center justify-center rounded-full bg-red-600"
                        onPress={handleReject}
                        disabled={actionState === "accepting"}
                    >
                        {actionState === "rejecting" ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
                        )}
                    </Pressable>

                    <Pressable
                        className="h-16 w-16 items-center justify-center rounded-full bg-emerald-600"
                        onPress={handleAccept}
                        disabled={actionState === "rejecting"}
                    >
                        {actionState === "accepting" ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Ionicons name="call" size={28} color="#fff" />
                        )}
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}
