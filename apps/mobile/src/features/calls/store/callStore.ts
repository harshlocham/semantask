import { create } from "zustand";

import type { ActiveCallSession, IncomingCallSignal } from "@/features/calls/types/callSignaling";

type CallActionState = "idle" | "accepting" | "rejecting";

type CallStoreState = {
    incomingCall: IncomingCallSignal | null;
    activeCall: ActiveCallSession | null;
    actionState: CallActionState;
    lastRejectedCallId: string | null;

    receiveIncomingCall: (payload: IncomingCallSignal) => void;
    setActionState: (state: CallActionState) => void;
    acceptIncomingCall: () => void;
    rejectIncomingCall: () => void;
    setActiveCall: (session: ActiveCallSession | null) => void;
    clearAll: () => void;
};

export const useCallStore = create<CallStoreState>((set, get) => ({
    incomingCall: null,
    activeCall: null,
    actionState: "idle",
    lastRejectedCallId: null,

    receiveIncomingCall: (payload) =>
        set((state) => {
            if (state.activeCall && state.activeCall.callId !== payload.callId) {
                return state;
            }

            return {
                incomingCall: payload,
                actionState: "idle",
                lastRejectedCallId: null,
            };
        }),

    setActionState: (actionState) => set({ actionState }),

    acceptIncomingCall: () =>
        set((state) => {
            const incoming = state.incomingCall;

            if (!incoming) {
                return state;
            }

            return {
                incomingCall: null,
                activeCall: {
                    callId: incoming.callId,
                    peer: incoming.from,
                    mediaType: incoming.mediaType,
                    startedAt: new Date().toISOString(),
                    conversationId: incoming.conversationId,
                    rtc: {
                        localDescription: undefined,
                        remoteDescription: undefined,
                        pendingIceCandidates: [],
                    },
                },
                actionState: "idle",
                lastRejectedCallId: null,
            };
        }),

    rejectIncomingCall: () =>
        set((state) => {
            const callId = state.incomingCall?.callId ?? null;

            return {
                incomingCall: null,
                actionState: "idle",
                lastRejectedCallId: callId,
            };
        }),

    setActiveCall: (activeCall) => set({ activeCall }),

    clearAll: () =>
        set({
            incomingCall: null,
            activeCall: null,
            actionState: "idle",
            lastRejectedCallId: null,
        }),
}));

export const callSelectors = {
    incomingCall: (state: CallStoreState) => state.incomingCall,
    actionState: (state: CallStoreState) => state.actionState,
};

export function buildActiveSessionFromIncoming(incoming: IncomingCallSignal): ActiveCallSession {
    return {
        callId: incoming.callId,
        peer: incoming.from,
        mediaType: incoming.mediaType,
        startedAt: new Date().toISOString(),
        conversationId: incoming.conversationId,
        rtc: {
            localDescription: undefined,
            remoteDescription: undefined,
            pendingIceCandidates: [],
        },
    };
}

export function normalizeIncomingCallPayload(payload: unknown): IncomingCallSignal | null {
    if (!payload || typeof payload !== "object") {
        return null;
    }

    const value = payload as {
        callId?: unknown;
        conversationId?: unknown;
        mediaType?: unknown;
        createdAt?: unknown;
        metadata?: unknown;
        from?: {
            _id?: unknown;
            name?: unknown;
            username?: unknown;
            avatar?: unknown;
            profilePicture?: unknown;
            lastSeen?: unknown;
        };
        caller?: {
            _id?: unknown;
            name?: unknown;
            username?: unknown;
            avatar?: unknown;
            profilePicture?: unknown;
            lastSeen?: unknown;
        };
    };

    const callId =
        typeof value.callId === "string" && value.callId.trim()
            ? value.callId
            : "";

    if (!callId) {
        return null;
    }

    const partySource = value.from ?? value.caller ?? null;
    const partyId = typeof partySource?._id === "string" ? partySource._id : "unknown";
    const partyName =
        typeof partySource?.name === "string" && partySource.name.trim()
            ? partySource.name
            : typeof partySource?.username === "string" && partySource.username.trim()
                ? partySource.username
                : "Unknown caller";

    const avatar =
        typeof partySource?.avatar === "string"
            ? partySource.avatar
            : typeof partySource?.profilePicture === "string"
                ? partySource.profilePicture
                : null;

    const lastSeen =
        typeof partySource?.lastSeen === "string" ? partySource.lastSeen : null;

    return {
        callId,
        conversationId: typeof value.conversationId === "string" ? value.conversationId : undefined,
        mediaType: value.mediaType === "video" ? "video" : "audio",
        createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
        from: {
            _id: partyId,
            name: partyName,
            avatar,
            lastSeen,
        },
        metadata:
            value.metadata && typeof value.metadata === "object"
                ? (value.metadata as Record<string, unknown>)
                : undefined,
    };
}
