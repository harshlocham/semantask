import mongoose from "mongoose";
import OutboxEventModel, { type IOutboxEvent, type OutboxTopic } from "@semantask/db/models/OutboxEvent";
import { connectToDatabase } from "@semantask/db";
import {
    getActiveTraceparent,
    mergeCorrelationIntoPayload,
} from "@semantask/observability";
import {
    buildOutboxArchivalFilter,
    buildOutboxClaimFilter,
} from "./outbox.helpers";

export type { OutboxPartitionConfig } from "./outbox.helpers";
export {
    buildOutboxArchivalFilter,
    buildOutboxClaimFilter,
    getOutboxPartitionConfig,
} from "./outbox.helpers";

export interface EnqueueOutboxEventInput {
    topic: OutboxTopic;
    dedupeKey: string;
    payload: Record<string, unknown>;
    session?: mongoose.ClientSession;
}

export async function enqueueOutboxEvent(input: EnqueueOutboxEventInput) {
    await connectToDatabase();

    const payload = mergeCorrelationIntoPayload(input.payload);
    const traceparent = getActiveTraceparent();
    if (traceparent && typeof payload.traceparent !== "string") {
        payload.traceparent = traceparent;
    }

    const doc = new OutboxEventModel({
        topic: input.topic,
        dedupeKey: input.dedupeKey,
        payload,
        status: "pending",
        attempts: 0,
        availableAt: new Date(),
    });

    await doc.save(input.session ? { session: input.session } : undefined);
    return doc;
}

export async function claimOutboxEvents(workerId: string, limit = 10): Promise<IOutboxEvent[]> {
    await connectToDatabase();

    const now = new Date();
    const staleProcessingCutoff = new Date(Date.now() - 5 * 60 * 1000);
    const claimed: IOutboxEvent[] = [];
    const filter = buildOutboxClaimFilter(now, staleProcessingCutoff);

    for (let i = 0; i < limit; i += 1) {
        const doc = await OutboxEventModel.findOneAndUpdate(
            filter,
            {
                $set: {
                    status: "processing",
                    lockedBy: workerId,
                    lockedAt: new Date(),
                },
                $inc: { attempts: 1 },
            },
            {
                sort: { createdAt: 1 },
                new: true,
            }
        );

        if (!doc) break;
        claimed.push(doc);
    }

    return claimed;
}

export async function archiveTerminalOutboxEvents(options?: {
    retentionDays?: number;
    now?: Date;
}): Promise<number> {
    await connectToDatabase();

    const rawDays = options?.retentionDays
        ?? Number(process.env.OUTBOX_RETENTION_DAYS || 14);
    const retentionDays =
        Number.isFinite(rawDays) && rawDays > 0 ? Math.floor(rawDays) : 14;
    const now = options?.now ?? new Date();
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    const result = await OutboxEventModel.deleteMany(buildOutboxArchivalFilter(cutoff));
    return result.deletedCount ?? 0;
}

export async function markOutboxEventCompleted(id: string) {
    await connectToDatabase();
    await OutboxEventModel.updateOne(
        { _id: id },
        {
            $set: {
                status: "completed",
                processedAt: new Date(),
                deadLetteredAt: null,
                lockedBy: null,
                lockedAt: null,
                lastError: null,
            },
        }
    );
}

export async function markOutboxEventFailed(id: string, errorMessage: string, retryDelayMs = 1000) {
    await connectToDatabase();
    await OutboxEventModel.updateOne(
        { _id: id },
        {
            $set: {
                status: "failed",
                availableAt: new Date(Date.now() + retryDelayMs),
                deadLetteredAt: null,
                lockedBy: null,
                lockedAt: null,
                lastError: errorMessage.slice(0, 4000),
            },
        }
    );
}

export async function markOutboxEventDeferred(id: string, reason: string, delayMs = 1000) {
    await connectToDatabase();
    await OutboxEventModel.updateOne(
        { _id: id },
        {
            $set: {
                status: "failed",
                availableAt: new Date(Date.now() + delayMs),
                deadLetteredAt: null,
                lockedBy: null,
                lockedAt: null,
                lastError: reason.slice(0, 4000),
            },
            $inc: { attempts: -1 },
        }
    );
}

export async function markOutboxEventDeadLetter(id: string, errorMessage: string) {
    await connectToDatabase();
    await OutboxEventModel.updateOne(
        { _id: id },
        {
            $set: {
                status: "dead_letter",
                deadLetteredAt: new Date(),
                lockedBy: null,
                lockedAt: null,
                lastError: errorMessage.slice(0, 4000),
            },
        }
    );
}
