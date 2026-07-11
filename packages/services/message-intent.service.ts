import mongoose from "mongoose";
import type { MessageIntentRecord, MessageSemanticType, TaskPriority } from "@semantask/types";
import { connectToDatabase } from "@semantask/db";
import MessageIntentModel, { type IMessageIntent } from "@semantask/db/models/MessageIntent";
import {
    extractEntitiesFromContent,
    mapSemanticTypeToIntentType,
    type ExtractedMessageEntities,
    type MessageIntentType,
} from "./message-intent.helpers.js";

export {
    extractEntitiesFromContent,
    mapSemanticTypeToIntentType,
    type ExtractedMessageEntities,
    type MessageIntentType,
};

export type UpsertMessageIntentInput = {
    messageId: string;
    conversationId: string;
    semanticType: MessageSemanticType;
    content: string;
    confidence: number;
    rawSummary: string;
    extractorVersion: string;
};

export function normalizeMessageIntent(doc: IMessageIntent): MessageIntentRecord {
    return {
        _id: doc._id.toString(),
        messageId: doc.messageId.toString(),
        conversationId: doc.conversationId.toString(),
        intentType: doc.intentType,
        entities: {
            actionVerb: doc.entities?.actionVerb ?? "",
            objectText: doc.entities?.objectText ?? "",
            assigneeUserIds: (doc.entities?.assigneeUserIds ?? []).map((id) => id.toString()),
            dueAtCandidate: doc.entities?.dueAtCandidate
                ? new Date(doc.entities.dueAtCandidate).toISOString()
                : null,
            priorityCandidate: (doc.entities?.priorityCandidate ?? "") as TaskPriority | "",
        },
        confidence: doc.confidence,
        extractorVersion: doc.extractorVersion,
        rawSummary: doc.rawSummary ?? "",
        createdAt: new Date(doc.createdAt).toISOString(),
    };
}

export async function upsertMessageIntent(input: UpsertMessageIntentInput): Promise<MessageIntentRecord> {
    await connectToDatabase();

    const intentType = mapSemanticTypeToIntentType(input.semanticType, input.content);
    const entities = extractEntitiesFromContent(input.content);
    const messageObjectId = new mongoose.Types.ObjectId(input.messageId);
    const conversationObjectId = new mongoose.Types.ObjectId(input.conversationId);

    const doc = await MessageIntentModel.findOneAndUpdate(
        { messageId: messageObjectId },
        {
            $set: {
                conversationId: conversationObjectId,
                intentType,
                entities: {
                    actionVerb: entities.actionVerb,
                    objectText: entities.objectText,
                    assigneeUserIds: entities.assigneeUserIds.map(
                        (id) => new mongoose.Types.ObjectId(id)
                    ),
                    dueAtCandidate: entities.dueAtCandidate,
                    priorityCandidate: entities.priorityCandidate,
                },
                confidence: Math.max(0, Math.min(1, input.confidence)),
                extractorVersion: input.extractorVersion,
                rawSummary: input.rawSummary.slice(0, 4000),
            },
            $setOnInsert: {
                messageId: messageObjectId,
                createdAt: new Date(),
            },
        },
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
        }
    ).exec();

    if (!doc) {
        throw new Error(`Failed to upsert MessageIntent for message ${input.messageId}`);
    }

    return normalizeMessageIntent(doc);
}

export async function getMessageIntentByMessageId(
    messageId: string
): Promise<MessageIntentRecord | null> {
    await connectToDatabase();

    const doc = await MessageIntentModel.findOne({
        messageId: new mongoose.Types.ObjectId(messageId),
    }).exec();

    if (!doc) {
        return null;
    }

    return normalizeMessageIntent(doc);
}
