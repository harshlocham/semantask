import { Conversation } from "@/models/Conversation";
import { connectToDatabase } from "@/lib/Db/db";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/utils/auth/requireAuthUser";
import { requireConversationAccess } from "@/lib/utils/auth/requireConversationAccess";
import mongoose from "mongoose";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    await connectToDatabase();
    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return NextResponse.json({ error: "Invalid conversation id" }, { status: 400 });
    }

    const access = await requireConversationAccess(id, guard.user);
    if (access.response) {
        return access.response;
    }

    const convo = await Conversation.findById(id)
        .populate("participants", "username email profilePicture");

    if (!convo) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json(convo);
}
