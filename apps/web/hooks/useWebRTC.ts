"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PeerManager } from "@/lib/webrtc/peer-manager";

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
    { urls: ["stun:stun.l.google.com:19302"] },
];

function createMediaStream(): MediaStream | null {
    if (typeof MediaStream === "undefined") {
        return null;
    }

    return new MediaStream();
}

type UseWebRTCOptions = {
    onIceCandidate?: (candidate: RTCIceCandidate) => void;
};

export function useWebRTC(options: UseWebRTCOptions = {}) {
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const [connectionState, setConnectionState] =
        useState<RTCPeerConnectionState>("new");

    const remoteStreamRef = useRef<MediaStream | null>(null);

    const getRemoteStream = useCallback(() => {
        if (!remoteStreamRef.current) {
            remoteStreamRef.current = createMediaStream();
        }

        return remoteStreamRef.current;
    }, []);

    const manager = useMemo(
        () =>
            new PeerManager(
                {
                    iceServers: DEFAULT_ICE_SERVERS,
                },
                {
                    onIceCandidate: options.onIceCandidate,
                    onTrack: (event) => {
                        const remote = getRemoteStream();
                        if (!remote) return;

                        event.streams[0]?.getTracks().forEach((track) => {
                            remote.addTrack(track);
                        });
                        const stream = createMediaStream();
                        if (!stream) return;

                        remote.getTracks().forEach((track) => {
                            stream.addTrack(track);
                        });

                        setRemoteStream(stream);
                    },
                    onConnectionStateChange: (state) => {
                        setConnectionState(state);
                    },
                }
            ),
        [getRemoteStream, options.onIceCandidate]
    );

    const startLocalMedia = useCallback(async () => {
        if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
            throw new Error("Camera and microphone access is unavailable in this environment.");
        }

        let stream: MediaStream;

        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: true,
            });
        } catch (error) {
            if (error instanceof DOMException && error.name === "NotAllowedError") {
                throw new Error("Permission denied by system for camera or microphone.");
            }

            throw error instanceof Error
                ? error
                : new Error("Unable to access camera or microphone.");
        }

        setLocalStream(stream);
        await manager.addLocalStream(stream);
        return stream;
    }, [manager]);

    const stopLocalMedia = useCallback(() => {
        localStream?.getTracks().forEach((track) => track.stop());
        setLocalStream(null);
    }, [localStream]);

    const createOffer = useCallback(async () => manager.createOffer(), [manager]);

    const handleOffer = useCallback(
        async (offer: RTCSessionDescriptionInit) => manager.handleOffer(offer),
        [manager]
    );

    const handleAnswer = useCallback(
        async (answer: RTCSessionDescriptionInit) => manager.handleAnswer(answer),
        [manager]
    );

    const handleICE = useCallback(
        async (candidate: RTCIceCandidateInit) => manager.handleICE(candidate),
        [manager]
    );

    const reconnect = useCallback(async () => manager.restartIce(), [manager]);

    const close = useCallback(() => {
        stopLocalMedia();
        remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
        remoteStreamRef.current = null;
        setRemoteStream(null);
        manager.close();
    }, [manager, stopLocalMedia]);

    useEffect(() => {
        return () => {
            close();
        };
    }, [close]);

    return {
        localStream,
        remoteStream,
        connectionState,
        startLocalMedia,
        stopLocalMedia,
        createOffer,
        handleOffer,
        handleAnswer,
        handleICE,
        reconnect,
        close,
    };
}
