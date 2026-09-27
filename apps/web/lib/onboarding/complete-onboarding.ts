import mongoose from "mongoose";
import { Conversation } from "@/models/Conversation";
import MessageModel from "@/models/Message";
import { User } from "@/models/User";
import { getInternalSocketServerUrl } from "@/lib/socket/socketConfig";
import { createInternalRequestHeaders } from "@semantask/types/utils/internal-bridge-auth";
import { enqueueOutboxEvent } from "@/lib/services/outbox.service";
import { GETTING_STARTED_GROUP_NAME, GETTING_STARTED_PROMPT } from "./constants";

export async function completeOnboardingConversation(
    userId: string,
    organizationId: string | null = null
): Promise<{ conversationId: string }> {
    const user = mongoose.Types.ObjectId.isValid(userId)
        ? await User.findById(userId)
        : null;
    if (!user) {
        throw new Error("User not found");
    }

    const orgScope = organizationId
        ? { organizationId }
        : { $or: [{ organizationId: null }, { organizationId: { $exists: false } }] };

    const existing = await Conversation.findOne({
        isGroup: true,
        groupName: GETTING_STARTED_GROUP_NAME,
        participants: user._id,
        ...orgScope,
    });

    if (existing) {
        const hasPrompt = await MessageModel.exists({
            conversationId: existing._id,
            content: GETTING_STARTED_PROMPT,
        });
        if (!hasPrompt) {
            await seedGettingStartedMessage(existing._id, user._id);
        }
        await ensureUserConversation(user, existing._id);
        return { conversationId: String(existing._id) };
    }

    const conversation = await Conversation.create({
        participants: [user._id],
        type: "group",
        isGroup: true,
        admin: String(user._id),
        groupName: GETTING_STARTED_GROUP_NAME,
        name: GETTING_STARTED_GROUP_NAME,
        organizationId: organizationId || null,
    });

    await seedGettingStartedMessage(conversation._id, user._id);
    await ensureUserConversation(user, conversation._id);

    const participantIds = [String(user._id)];
    try {
        const internalResponse = await fetch(`${getInternalSocketServerUrl()}/internal/conversation-created`, {
            method: "POST",
            headers: createInternalRequestHeaders(),
            body: JSON.stringify({
                conversationId: String(conversation._id),
                participantIds,
            }),
        });
        if (!internalResponse.ok) {
            console.warn("Onboarding conversation created but socket fan-out failed", {
                conversationId: String(conversation._id),
                status: internalResponse.status,
            });
        }
    } catch (error) {
        console.warn("Onboarding conversation created but socket fan-out failed", error);
    }

    return { conversationId: String(conversation._id) };
}

async function seedGettingStartedMessage(
    conversationId: mongoose.Types.ObjectId,
    senderId: mongoose.Types.ObjectId
) {
    const message = await MessageModel.create({
        sender: senderId,
        content: GETTING_STARTED_PROMPT,
        conversationId,
        messageType: "text",
        status: "sent",
    });

    await Conversation.findByIdAndUpdate(conversationId, {
        lastMessage: {
            _id: message._id,
            sender: senderId,
            messageType: "text",
            content: message.content,
            _creationTime: message.createdAt,
        },
    });

    await enqueueOutboxEvent({
        topic: "message.created",
        dedupeKey: `message.created:${message._id.toString()}`,
        payload: {
            messageId: message._id.toString(),
            conversationId: conversationId.toString(),
            senderId: senderId.toString(),
            content: message.content,
            messageType: "text",
        },
    });
}

async function ensureUserConversation(
    user: { conversations: mongoose.Types.ObjectId[]; save: () => Promise<unknown> },
    conversationId: mongoose.Types.ObjectId
) {
    if (!Array.isArray(user.conversations)) {
        user.conversations = [];
    }
    const alreadyLinked = user.conversations.some((id) => String(id) === String(conversationId));
    if (alreadyLinked) {
        return;
    }
    user.conversations.push(conversationId);
    await user.save();
}
