import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/Db/db";
import Message from "@/models/Message";
import { internalSocketAuthzRateLimiter } from "@/lib/utils/rateLimiter";
import {
    getInternalSecret,
    hasValidInternalSecret,
    INTERNAL_SECRET_HEADER,
} from "@semantask/types/utils/internal-bridge-auth";

type MessageAction = "edit" | "delete";

type AuthorizeBody = {
    action?: MessageAction;
    actorUserId?: string;
    conversationId?: string;
    messageId?: string;
    text?: string;
};

function deny(reason: string, status = 403) {
    return NextResponse.json({ allowed: false, reason }, { status });
}

export async function POST(req: Request) {
    const providedSecret = req.headers.get(INTERNAL_SECRET_HEADER);
    if (!hasValidInternalSecret(providedSecret, getInternalSecret())) {
        return deny("unauthorized_internal_request", 401);
    }

    let body: AuthorizeBody;
    try {
        body = (await req.json()) as AuthorizeBody;
    } catch {
        return deny("invalid_json", 400);
    }

    const { action, actorUserId, conversationId, messageId, text } = body;
    if (
        (action !== "edit" && action !== "delete") ||
        !actorUserId ||
        !conversationId ||
        !messageId
    ) {
        return deny("invalid_payload", 400);
    }

    const key = `${actorUserId}:${action}`;
    const { success } = await internalSocketAuthzRateLimiter.limit(key);
    if (!success) {
        return deny("too_many_requests", 429);
    }

    await connectToDatabase();

    const message = await Message.findOne({
        _id: messageId,
        conversationId,
        sender: actorUserId,
    })
        .select("content isEdited isDeleted")
        .lean<{ content: string; isEdited?: boolean; isDeleted?: boolean } | null>();

    if (!message) {
        return deny("not_owner_or_not_found");
    }

    if (action === "delete") {
        if (!message.isDeleted) {
            return deny("delete_not_persisted");
        }

        return NextResponse.json({ allowed: true });
    }

    if (typeof text !== "string" || !text.trim()) {
        return deny("invalid_edit_text", 400);
    }

    if (!message.isEdited) {
        return deny("edit_not_persisted");
    }

    if (message.content !== text.trim()) {
        return deny("edit_content_mismatch");
    }

    return NextResponse.json({ allowed: true });
}
