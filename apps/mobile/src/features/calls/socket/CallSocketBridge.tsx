import { useCallback, useEffect } from "react";

import { useSocket } from "@/providers/socket-provider";
import {
    CallSignalingEvents,
    type ActiveCallSession,
} from "@/features/calls/types/callSignaling";
import {
    normalizeIncomingCallPayload,
    useCallStore,
} from "@/features/calls/store/callStore";

function normalizeActiveCall(payload: unknown): ActiveCallSession | null {
    if (!payload || typeof payload !== "object") {
        return null;
    }

    const value = payload as {
        callId?: unknown;
        mediaType?: unknown;
        startedAt?: unknown;
        conversationId?: unknown;
        peer?: {
            _id?: unknown;
            name?: unknown;
            username?: unknown;
            avatar?: unknown;
            profilePicture?: unknown;
            lastSeen?: unknown;
        };
    };

    if (typeof value.callId !== "string" || !value.callId) {
        return null;
    }

    const peerName =
        typeof value.peer?.name === "string" && value.peer.name.trim()
            ? value.peer.name
            : typeof value.peer?.username === "string" && value.peer.username.trim()
                ? value.peer.username
                : "Unknown";

    return {
        callId: value.callId,
        mediaType: value.mediaType === "video" ? "video" : "audio",
        startedAt: typeof value.startedAt === "string" ? value.startedAt : new Date().toISOString(),
        conversationId: typeof value.conversationId === "string" ? value.conversationId : undefined,
        peer: {
            _id: typeof value.peer?._id === "string" ? value.peer._id : "unknown",
            name: peerName,
            avatar:
                typeof value.peer?.avatar === "string"
                    ? value.peer.avatar
                    : typeof value.peer?.profilePicture === "string"
                        ? value.peer.profilePicture
                        : null,
            lastSeen: typeof value.peer?.lastSeen === "string" ? value.peer.lastSeen : null,
        },
        rtc: {
            localDescription: undefined,
            remoteDescription: undefined,
            pendingIceCandidates: [],
        },
    };
}

export default function CallSocketBridge() {
    const { on, off } = useSocket();
    const receiveIncomingCall = useCallStore((state) => state.receiveIncomingCall);
    const rejectIncomingCall = useCallStore((state) => state.rejectIncomingCall);
    const setActiveCall = useCallStore((state) => state.setActiveCall);

    const handleIncomingCall = useCallback(
        (payload: unknown) => {
            const incoming = normalizeIncomingCallPayload(payload);

            if (!incoming) {
                return;
            }

            receiveIncomingCall(incoming);
        },
        [receiveIncomingCall]
    );

    const handleCallAccepted = useCallback(
        (payload: unknown) => {
            const activeSession = normalizeActiveCall(payload);

            if (!activeSession) {
                return;
            }

            setActiveCall(activeSession);
        },
        [setActiveCall]
    );

    const handleCallRejected = useCallback(() => {
        rejectIncomingCall();
        setActiveCall(null);
    }, [rejectIncomingCall, setActiveCall]);

    useEffect(() => {
        on(CallSignalingEvents.INCOMING, handleIncomingCall);
        on(CallSignalingEvents.ACCEPT, handleCallAccepted);
        on(CallSignalingEvents.REJECT, handleCallRejected);

        return () => {
            off(CallSignalingEvents.INCOMING, handleIncomingCall);
            off(CallSignalingEvents.ACCEPT, handleCallAccepted);
            off(CallSignalingEvents.REJECT, handleCallRejected);
        };
    }, [handleCallAccepted, handleCallRejected, handleIncomingCall, off, on]);

    return null;
}
