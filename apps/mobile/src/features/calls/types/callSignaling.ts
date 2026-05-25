export type CallMediaType = "audio" | "video";

export type CallParty = {
    _id: string;
    name: string;
    avatar: string | null;
    lastSeen: string | null;
};

export type IncomingCallSignal = {
    callId: string;
    from: CallParty;
    mediaType: CallMediaType;
    conversationId?: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
};

export type ActiveCallSession = {
    callId: string;
    peer: CallParty;
    mediaType: CallMediaType;
    startedAt: string;
    conversationId?: string;
    // Todo: Define RTC session details when integrating WebRTC.
    // WebRTC placeholders for future integration.
    rtc: {
        localDescription?: unknown;
        remoteDescription?: unknown;
        pendingIceCandidates: unknown[];
    };
};

export const CallSignalingEvents = {
    INCOMING: "call:incoming",
    ACCEPT: "call:accept",
    REJECT: "call:reject",
} as const;
