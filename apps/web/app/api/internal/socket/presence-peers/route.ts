import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/Db/db";
import { Conversation } from "@/models/Conversation";
import {
    hasValidInternalSecret,
    INTERNAL_SECRET_HEADER,
} from "@semantask/types/utils/internal-bridge-auth";

const PRESENCE_PEER_CAP = 2000;

type PresencePeersBody = {
    userId?: string;
};

export async function POST(req: Request) {
    const providedSecret = req.headers.get(INTERNAL_SECRET_HEADER);
    if (!hasValidInternalSecret(providedSecret, "web")) {
        return NextResponse.json({ error: "unauthorized_internal_request" }, { status: 401 });
    }

    let body: PresencePeersBody;
    try {
        body = (await req.json()) as PresencePeersBody;
    } catch {
        return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const userId = body.userId?.trim();
    if (!userId || !mongoose.isValidObjectId(userId)) {
        return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    }

    try {
        await connectToDatabase();

        const userObjectId = new mongoose.Types.ObjectId(userId);
        const conversations = await Conversation.find(
            { participants: userObjectId },
            { participants: 1 }
        )
            .lean()
            .limit(5_000);

        const peerIds = new Set<string>();
        for (const conversation of conversations) {
            const participants = conversation.participants ?? [];
            for (const participant of participants) {
                const peerId = String(participant);
                if (peerId === userId) {
                    continue;
                }
                peerIds.add(peerId);
                if (peerIds.size >= PRESENCE_PEER_CAP) {
                    break;
                }
            }
            if (peerIds.size >= PRESENCE_PEER_CAP) {
                break;
            }
        }

        return NextResponse.json({ peerIds: Array.from(peerIds) });
    } catch (error) {
        console.error("presence-peers error", error);
        return NextResponse.json({ error: "presence_peers_failed" }, { status: 500 });
    }
}
