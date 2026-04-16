"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import {
    SocketEvents,
    type CallAcceptPayload,
    type CallAnswerPayload,
    type CallIceCandidatePayload,
    type CallOfferPayload,
    type CallRejectPayload,
} from "@chat/types";
import { useCallSignaling } from "@/hooks/useCallSignaling";
import { useCallState } from "@/hooks/useCallState";
import { useSocket } from "@/hooks/useSocket";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useUser } from "@/context/UserContext";
import useCallStore from "@/store/call-store";
import { Button } from "@/components/ui/button";

interface CallControllerProps {
    conversationId?: string;
    peerUserId?: string;
    peerName?: string;
}

export default function CallController({ conversationId, peerUserId, peerName }: CallControllerProps) {
    const socket = useSocket();
    const { user } = useUser();
    const currentUserId = user?._id ? String(user._id) : null;

    const {
        callId,
        conversationId: callConversationId,
        status,
        direction,
        participants,
        canAccept,
        hasActiveCall,
        isIncomingModalOpen,
    } = useCallState();
    const {
        emitOfferInit,
        emitOffer,
        emitAccept,
        emitReject,
        emitAnswer,
        emitEnd,
        emitIceCandidate,
        emitReconnect,
    } = useCallSignaling();

    const startOutgoingCall = useCallStore((state) => state.startOutgoingCall);
    const markEnded = useCallStore((state) => state.endCall);
    const setMuted = useCallStore((state) => state.setMuted);
    const setCameraOn = useCallStore((state) => state.setCameraOn);
    const setError = useCallStore((state) => state.setError);
    const isMuted = useCallStore((state) => state.isMuted);
    const isCameraOn = useCallStore((state) => state.isCameraOn);
    const startVideoRequestNonce = useCallStore((state) => state.startVideoRequestNonce);

    const activePeerIdRef = useRef<string | null>(null);
    const activeCallIdRef = useRef<string | null>(null);
    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const reconnectRequestedRef = useRef(false);
    const lastReconnectEmitAtRef = useRef(0);

    useEffect(() => {
        activeCallIdRef.current = callId;
    }, [callId]);

    const handleLocalIceCandidate = useCallback(
        (candidate: RTCIceCandidate) => {
            if (!currentUserId) return;

            const to = activePeerIdRef.current;
            if (!to) return;

            emitIceCandidate({
                callId: activeCallIdRef.current ?? undefined,
                from: currentUserId,
                to,
                candidate: candidate.toJSON(),
                mid: candidate.sdpMid,
                mLineIndex: candidate.sdpMLineIndex,
            });
        },
        [currentUserId, emitIceCandidate]
    );

    const {
        localStream,
        remoteStream,
        connectionState,
        startLocalMedia,
        createOffer,
        handleOffer,
        handleAnswer,
        handleICE,
        reconnect,
        close,
    } = useWebRTC({
        onIceCandidate: handleLocalIceCandidate,
    });

    const resolvedConversationId = conversationId ?? callConversationId ?? "";
    const resolvedPeerName = peerName ?? "User";

    const derivedPeerId = useMemo(() => {
        if (peerUserId) return peerUserId;
        if (!currentUserId) return null;

        const other = participants.find((p) => p.userId !== currentUserId);
        return other?.userId ?? null;
    }, [currentUserId, participants, peerUserId]);

    const handleMediaAccessFailure = useCallback(
        (error: unknown, mode: "incoming" | "outgoing") => {
            const message = error instanceof Error ? error.message : "Unable to access camera or microphone.";
            setError(message);

            if (mode === "incoming") {
                if (callId && derivedPeerId && currentUserId && resolvedConversationId) {
                    emitReject({
                        callId,
                        conversationId: resolvedConversationId,
                        from: currentUserId,
                        to: derivedPeerId,
                        reason: "declined",
                    });
                }

                close();
                return;
            }

            if (callId && derivedPeerId && currentUserId) {
                emitEnd({
                    callId,
                    from: currentUserId,
                    to: derivedPeerId,
                    reason: "error",
                    endedAt: new Date().toISOString(),
                });
            }

            markEnded();
            close();
        },
        [callId, close, currentUserId, derivedPeerId, emitEnd, emitReject, markEnded, resolvedConversationId, setError]
    );

    useEffect(() => {
        if (!localVideoRef.current) return;
        localVideoRef.current.srcObject = localStream;
    }, [localStream]);

    useEffect(() => {
        if (!remoteVideoRef.current) return;
        remoteVideoRef.current.srcObject = remoteStream;
    }, [remoteStream]);

    useEffect(() => {
        if (!currentUserId) return;

        const onOffer = async (payload: CallOfferPayload) => {
            if (payload.to !== currentUserId || payload.from === currentUserId) return;

            try {
                activePeerIdRef.current = payload.from;
                if (payload.callId) {
                    activeCallIdRef.current = payload.callId;
                }

                try {
                    await startLocalMedia();
                } catch (error) {
                    handleMediaAccessFailure(error, "incoming");
                    return;
                }
                const answer = await handleOffer(payload.offer);

                emitAnswer({
                    callId: payload.callId ?? activeCallIdRef.current ?? undefined,
                    from: currentUserId,
                    to: payload.from,
                    answer,
                });
            } catch (error) {
                console.error("Failed handling call offer", error);
            }
        };

        const onAnswer = async (payload: CallAnswerPayload) => {
            if (payload.to !== currentUserId || payload.from === currentUserId) return;

            try {
                activePeerIdRef.current = payload.from;
                if (payload.callId) {
                    activeCallIdRef.current = payload.callId;
                }
                await handleAnswer(payload.answer);
            } catch (error) {
                console.error("Failed handling call answer", error);
            }
        };

        const onAccepted = async (payload: CallAcceptPayload) => {
            if (payload.to !== currentUserId || payload.from === currentUserId) return;

            try {
                activePeerIdRef.current = payload.from;
                activeCallIdRef.current = payload.callId;
                try {
                    await startLocalMedia();
                } catch (error) {
                    handleMediaAccessFailure(error, "outgoing");
                    return;
                }
                const offer = await createOffer();

                emitOffer({
                    callId: payload.callId,
                    conversationId: payload.conversationId,
                    from: currentUserId,
                    to: payload.from,
                    offer,
                });
            } catch (error) {
                console.error("Failed creating offer after call accept", error);
            }
        };

        const onCallClosed = () => {
            activePeerIdRef.current = null;
            activeCallIdRef.current = null;
            reconnectRequestedRef.current = false;
            close();
        };

        const onIceCandidate = async (payload: CallIceCandidatePayload) => {
            if (payload.to !== currentUserId || payload.from === currentUserId) return;

            try {
                activePeerIdRef.current = payload.from;
                if (payload.callId) {
                    activeCallIdRef.current = payload.callId;
                }
                await handleICE(payload.candidate);
            } catch (error) {
                console.error("Failed handling call ICE candidate", error);
            }
        };

        const onReconnect = async (payload: { callId?: string; from: string; to: string; iceRestartRequired?: boolean }) => {
            if (payload.to !== currentUserId || payload.from === currentUserId) return;

            activePeerIdRef.current = payload.from;
            if (payload.callId) {
                activeCallIdRef.current = payload.callId;
            }

            if (!payload.iceRestartRequired) return;

            try {
                const offer = await reconnect();
                emitOffer({
                    callId: payload.callId ?? activeCallIdRef.current ?? undefined,
                    conversationId: resolvedConversationId || undefined,
                    from: currentUserId,
                    to: payload.from,
                    offer,
                });
            } catch (error) {
                console.error("Failed handling reconnect ice restart", error);
            }
        };

        socket.on(SocketEvents.CALL_OFFER, onOffer);
        socket.on(SocketEvents.CALL_ANSWER, onAnswer);
        socket.on(SocketEvents.CALL_ICE_CANDIDATE, onIceCandidate);
        socket.on(SocketEvents.CALL_ACCEPT, onAccepted);
        socket.on(SocketEvents.CALL_RECONNECT, onReconnect);
        socket.on(SocketEvents.CALL_END, onCallClosed);
        socket.on(SocketEvents.CALL_REJECT, onCallClosed);

        return () => {
            socket.off(SocketEvents.CALL_OFFER, onOffer);
            socket.off(SocketEvents.CALL_ANSWER, onAnswer);
            socket.off(SocketEvents.CALL_ICE_CANDIDATE, onIceCandidate);
            socket.off(SocketEvents.CALL_ACCEPT, onAccepted);
            socket.off(SocketEvents.CALL_RECONNECT, onReconnect);
            socket.off(SocketEvents.CALL_END, onCallClosed);
            socket.off(SocketEvents.CALL_REJECT, onCallClosed);
        };
    }, [
        close,
        createOffer,
        currentUserId,
        handleMediaAccessFailure,
        emitOffer,
        emitAnswer,
        handleAnswer,
        handleICE,
        handleOffer,
        reconnect,
        resolvedConversationId,
        socket,
        startLocalMedia,
    ]);

    useEffect(() => {
        if (!currentUserId || !hasActiveCall || !callId) return;

        const to = activePeerIdRef.current ?? derivedPeerId;
        if (!to) return;

        if (connectionState === "disconnected" || connectionState === "failed") {
            const now = Date.now();
            if (now - lastReconnectEmitAtRef.current < 3000) return;

            reconnectRequestedRef.current = true;
            lastReconnectEmitAtRef.current = now;

            emitReconnect({
                callId,
                from: currentUserId,
                to,
                iceRestartRequired: true,
            });
            return;
        }

        if (connectionState === "connected" && reconnectRequestedRef.current) {
            reconnectRequestedRef.current = false;
            emitReconnect({
                callId,
                from: currentUserId,
                to,
                iceRestartRequired: false,
            });
        }
    }, [callId, connectionState, currentUserId, derivedPeerId, emitReconnect, hasActiveCall]);

    useEffect(() => {
        if (!currentUserId || !hasActiveCall || !callId) return;

        const intervalId = setInterval(() => {
            const to = activePeerIdRef.current ?? derivedPeerId;
            if (!to) return;

            emitReconnect({
                callId,
                from: currentUserId,
                to,
                iceRestartRequired: false,
            });
        }, 20000);

        return () => {
            clearInterval(intervalId);
        };
    }, [callId, currentUserId, derivedPeerId, emitReconnect, hasActiveCall]);

    const startVideoCall = useCallback(async () => {
        if (!currentUserId || !derivedPeerId || !resolvedConversationId) return;

        const nextCallId = uuidv4();
        activePeerIdRef.current = derivedPeerId;
        activeCallIdRef.current = nextCallId;

        startOutgoingCall({
            callId: nextCallId,
            conversationId: resolvedConversationId,
            callType: "video",
            participants: [{ userId: currentUserId }, { userId: derivedPeerId }],
        });

        emitOfferInit({
            callId: nextCallId,
            conversationId: resolvedConversationId,
            from: currentUserId,
            to: derivedPeerId,
            callType: "video",
        });
    }, [currentUserId, derivedPeerId, emitOfferInit, resolvedConversationId, startOutgoingCall]);

    const showPanel = Boolean(
        isIncomingModalOpen ||
        hasActiveCall ||
        status === "ringing" ||
        status === "accepted"
    );

    const lastHandledStartRequestRef = useRef(0);

    useEffect(() => {
        const isPanelVisible =
            isIncomingModalOpen ||
            hasActiveCall ||
            status === "ringing" ||
            status === "accepted";

        if (startVideoRequestNonce <= 0) return;
        if (startVideoRequestNonce === lastHandledStartRequestRef.current) return;
        if (isPanelVisible || direction === "incoming") return;

        lastHandledStartRequestRef.current = startVideoRequestNonce;
        void startVideoCall();
    }, [
        direction,
        hasActiveCall,
        isIncomingModalOpen,
        startVideoCall,
        startVideoRequestNonce,
        status,
    ]);

    const acceptIncomingCall = useCallback(async () => {
        if (!currentUserId || !callId || !resolvedConversationId || !derivedPeerId) return;

        activePeerIdRef.current = derivedPeerId;
        activeCallIdRef.current = callId;

        try {
            await startLocalMedia();
        } catch (error) {
            handleMediaAccessFailure(error, "incoming");
            return;
        }
        emitAccept({
            callId,
            conversationId: resolvedConversationId,
            from: currentUserId,
            to: derivedPeerId,
            acceptedAt: new Date().toISOString(),
        });
    }, [callId, currentUserId, derivedPeerId, emitAccept, handleMediaAccessFailure, resolvedConversationId, startLocalMedia]);

    const rejectIncomingCall = useCallback(() => {
        if (!currentUserId || !callId || !resolvedConversationId || !derivedPeerId) return;

        const payload: CallRejectPayload = {
            callId,
            conversationId: resolvedConversationId,
            from: currentUserId,
            to: derivedPeerId,
            reason: "declined",
        };

        emitReject(payload);
        activePeerIdRef.current = null;
        activeCallIdRef.current = null;
        reconnectRequestedRef.current = false;
        close();
    }, [callId, close, currentUserId, derivedPeerId, emitReject, resolvedConversationId]);

    const endCurrentCall = useCallback(() => {
        if (!currentUserId) return;

        const to = activePeerIdRef.current ?? derivedPeerId;
        if (to) {
            emitEnd({
                callId: activeCallIdRef.current ?? callId ?? undefined,
                from: currentUserId,
                to,
                reason: "hangup",
                endedAt: new Date().toISOString(),
            });
        }

        markEnded();
        activePeerIdRef.current = null;
        activeCallIdRef.current = null;
        reconnectRequestedRef.current = false;
        close();
    }, [callId, close, currentUserId, derivedPeerId, emitEnd, markEnded]);

    const toggleMute = useCallback(() => {
        const nextMuted = !isMuted;
        localStream?.getAudioTracks().forEach((track) => {
            track.enabled = !nextMuted;
        });
        setMuted(nextMuted);
    }, [isMuted, localStream, setMuted]);

    const toggleCamera = useCallback(() => {
        const nextCameraOn = !isCameraOn;
        localStream?.getVideoTracks().forEach((track) => {
            track.enabled = nextCameraOn;
        });
        setCameraOn(nextCameraOn);
    }, [isCameraOn, localStream, setCameraOn]);

    return (
        <>
            {showPanel && (
                <div className="fixed bottom-24 right-3 z-40 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl lg:bottom-6 lg:right-6">
                    <div className="border-b border-[hsl(var(--border))] px-3 py-2 text-sm font-medium text-[hsl(var(--foreground))]">
                        Call with {resolvedPeerName}
                    </div>

                    <div className="grid grid-cols-2 gap-2 p-2">
                        <div className="relative aspect-video overflow-hidden rounded-md bg-[hsl(var(--gray-secondary))]">
                            <video
                                ref={localVideoRef}
                                autoPlay
                                muted
                                playsInline
                                className="h-full w-full object-cover"
                            />
                            <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">You</span>
                        </div>
                        <div className="relative aspect-video overflow-hidden rounded-md bg-[hsl(var(--gray-secondary))]">
                            <video
                                ref={remoteVideoRef}
                                autoPlay
                                playsInline
                                className="h-full w-full object-cover"
                            />
                            <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">Remote</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 px-2 pb-2">
                        {canAccept && (
                            <>
                                <Button
                                    type="button"
                                    onClick={acceptIncomingCall}
                                    className="flex-1"
                                >
                                    Accept
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={rejectIncomingCall}
                                    className="flex-1"
                                >
                                    Reject
                                </Button>
                            </>
                        )}

                        {(hasActiveCall || status === "ringing" || status === "accepted") && (
                            <Button
                                type="button"
                                variant="destructive"
                                onClick={endCurrentCall}
                                className="flex-1"
                            >
                                End
                            </Button>
                        )}
                    </div>

                    {hasActiveCall && (
                        <div className="flex items-center gap-2 border-t border-[hsl(var(--border))] px-2 pb-2 pt-2">
                            <Button type="button" variant="outline" onClick={toggleMute} className="flex-1">
                                {isMuted ? "Unmute" : "Mute"}
                            </Button>
                            <Button type="button" variant="outline" onClick={toggleCamera} className="flex-1">
                                {isCameraOn ? "Camera Off" : "Camera On"}
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </>
    );
}