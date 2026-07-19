import mongoose, { Types } from "mongoose";
import { connectToDatabase } from "@semantask/db";
import UsageEventModel, { type IUsageEvent } from "@semantask/db/models/UsageEvent";
import { enqueueOutboxEvent } from "./outbox.service";
import { isMongoTransactionUnsupported } from "./mongo-transaction";

export type RecordUsageEventInput = {
    organizationId?: string | null;
    userId?: string | null;
    taskId?: string | null;
    inputTokens?: number;
    outputTokens?: number;
    model?: string | null;
    emitBillingEvent?: boolean;
};

function isValidObjectId(value: string | null | undefined): value is string {
    return Boolean(value && Types.ObjectId.isValid(value));
}

function nonNeg(value: number | undefined): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return 0;
    }
    return Math.floor(value);
}

/**
 * Persist LLM usage. Best-effort — never throws to callers (logs instead).
 * When billing emit is enabled, usage + outbox are written in one transaction
 * (with standalone-Mongo fallback).
 */
export async function recordUsageEvent(
    input: RecordUsageEventInput
): Promise<IUsageEvent | null> {
    try {
        const inputTokens = nonNeg(input.inputTokens);
        const outputTokens = nonNeg(input.outputTokens);
        const totalTokens = inputTokens + outputTokens;

        if (totalTokens <= 0 && !input.model) {
            return null;
        }

        await connectToDatabase();

        const docFields = {
            organizationId: isValidObjectId(input.organizationId)
                ? new Types.ObjectId(input.organizationId)
                : null,
            userId: isValidObjectId(input.userId) ? new Types.ObjectId(input.userId) : null,
            taskId: isValidObjectId(input.taskId) ? new Types.ObjectId(input.taskId) : null,
            inputTokens,
            outputTokens,
            totalTokens,
            llmModel: input.model ?? null,
        };

        const shouldEmitBilling = input.emitBillingEvent !== false && Boolean(input.organizationId);

        const persist = async (session?: mongoose.ClientSession): Promise<IUsageEvent> => {
            const created = await UsageEventModel.create(
                [docFields],
                session ? { session } : undefined
            );
            const event = created[0];

            if (shouldEmitBilling && input.organizationId) {
                await enqueueOutboxEvent({
                    topic: "billing.usage.recorded",
                    dedupeKey: `billing.usage.${event._id.toString()}`,
                    payload: {
                        usageEventId: event._id.toString(),
                        organizationId: input.organizationId,
                        userId: input.userId ?? null,
                        taskId: input.taskId ?? null,
                        inputTokens,
                        outputTokens,
                        totalTokens,
                        model: input.model ?? null,
                        llmModel: input.model ?? null,
                        recordedAt: new Date().toISOString(),
                    },
                    session,
                });
            }

            return event;
        };

        if (!shouldEmitBilling) {
            return await persist();
        }

        const session = await mongoose.startSession();
        try {
            let event: IUsageEvent | null = null;
            await session.withTransaction(async () => {
                event = await persist(session);
            });
            return event;
        } catch (error) {
            if (!isMongoTransactionUnsupported(error)) {
                throw error;
            }
            return await persist();
        } finally {
            await session.endSession();
        }
    } catch (error) {
        console.error("usage_event.write_failed", {
            organizationId: input.organizationId ?? null,
            taskId: input.taskId ?? null,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

export async function sumOrganizationTokensSince(
    organizationId: string,
    since: Date
): Promise<number> {
    if (!isValidObjectId(organizationId)) {
        return 0;
    }

    await connectToDatabase();
    // Relies on compound index idx_usage_org_created (organizationId + createdAt).
    const rows = await UsageEventModel.aggregate<{ total: number }>([
        {
            $match: {
                organizationId: new Types.ObjectId(organizationId),
                createdAt: { $gte: since },
            },
        },
        { $group: { _id: null, total: { $sum: "$totalTokens" } } },
    ]);

    return rows[0]?.total ?? 0;
}
