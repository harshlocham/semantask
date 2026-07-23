import { Types } from "mongoose";
import { connectToDatabase } from "@semantask/db";
import OrganizationMembershipModel from "@semantask/db/models/OrganizationMembership";
import OrganizationQuotaModel, {
    type IOrganizationQuota,
} from "@semantask/db/models/OrganizationQuota";
import TaskModel from "@semantask/db/models/Task";
import UsageEventModel from "@semantask/db/models/UsageEvent";
import { enqueueOutboxEvent } from "./outbox.service";
import { ValidationError } from "./organization-errors";

export class OrgQuotaExceededError extends Error {
    readonly code = "ORG_QUOTA_EXCEEDED" as const;

    constructor(message: string) {
        super(message);
        this.name = "OrgQuotaExceededError";
    }
}

/** Hourly bucket for billing.quota.exceeded outbox dedupe. */
function quotaExceededDedupeBucket(now = new Date()): string {
    return now.toISOString().slice(0, 13); // YYYY-MM-DDTHH
}

function isValidObjectId(value: string | null | undefined): value is string {
    return Boolean(value && Types.ObjectId.isValid(value));
}

export async function getOrganizationQuota(
    organizationId: string
): Promise<IOrganizationQuota | null> {
    if (!isValidObjectId(organizationId)) {
        return null;
    }

    await connectToDatabase();
    return OrganizationQuotaModel.findOne({
        organizationId: new Types.ObjectId(organizationId),
    }).lean<IOrganizationQuota>();
}

export async function upsertOrganizationQuota(input: {
    organizationId: string;
    maxTasksPerDay?: number | null;
    maxTokensPerMonth?: number | null;
    maxMembers?: number | null;
}): Promise<IOrganizationQuota> {
    if (!isValidObjectId(input.organizationId)) {
        throw new ValidationError("Invalid organizationId");
    }

    await connectToDatabase();

    const updated = await OrganizationQuotaModel.findOneAndUpdate(
        { organizationId: new Types.ObjectId(input.organizationId) },
        {
            $set: {
                ...(input.maxTasksPerDay !== undefined
                    ? { maxTasksPerDay: input.maxTasksPerDay }
                    : {}),
                ...(input.maxTokensPerMonth !== undefined
                    ? { maxTokensPerMonth: input.maxTokensPerMonth }
                    : {}),
                ...(input.maxMembers !== undefined ? { maxMembers: input.maxMembers } : {}),
            },
            $setOnInsert: {
                organizationId: new Types.ObjectId(input.organizationId),
            },
        },
        { upsert: true, new: true, runValidators: true }
    ).lean<IOrganizationQuota>();

    if (!updated) {
        throw new Error("Failed to upsert organization quota");
    }

    return updated;
}

export async function assertMemberQuotaAvailable(organizationId: string): Promise<void> {
    const quota = await getOrganizationQuota(organizationId);
    if (!quota?.maxMembers) {
        return;
    }

    await connectToDatabase();
    const count = await OrganizationMembershipModel.countDocuments({
        organizationId: new Types.ObjectId(organizationId),
    });

    if (count >= quota.maxMembers) {
        throw new OrgQuotaExceededError(
            `Organization member quota exceeded (${count}/${quota.maxMembers}).`
        );
    }
}

export async function assertTaskQuotaAvailable(organizationId: string): Promise<void> {
    const quota = await getOrganizationQuota(organizationId);
    if (!quota?.maxTasksPerDay) {
        return;
    }

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    await connectToDatabase();
    const count = await TaskModel.countDocuments({
        organizationId: new Types.ObjectId(organizationId),
        createdAt: { $gte: startOfDay },
    });

    if (count >= quota.maxTasksPerDay) {
        throw new OrgQuotaExceededError(
            `Organization daily task quota exceeded (${count}/${quota.maxTasksPerDay}).`
        );
    }
}

export async function assertTokenQuotaAvailable(organizationId: string): Promise<void> {
    const quota = await getOrganizationQuota(organizationId);
    if (!quota?.maxTokensPerMonth) {
        return;
    }

    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    await connectToDatabase();
    const rows = await UsageEventModel.aggregate<{ total: number }>([
        {
            $match: {
                organizationId: new Types.ObjectId(organizationId),
                createdAt: { $gte: startOfMonth },
            },
        },
        { $group: { _id: null, total: { $sum: "$totalTokens" } } },
    ]);

    const total = rows[0]?.total ?? 0;
    if (total >= quota.maxTokensPerMonth) {
        throw new OrgQuotaExceededError(
            `Organization monthly token quota exceeded (${total}/${quota.maxTokensPerMonth}).`
        );
    }
}

export async function assertExecutionQuotas(
    organizationId: string | null | undefined
): Promise<void> {
    if (!organizationId) {
        return;
    }

    try {
        await assertTaskQuotaAvailable(organizationId);
        await assertTokenQuotaAvailable(organizationId);
    } catch (error) {
        if (error instanceof OrgQuotaExceededError) {
            try {
                await enqueueOutboxEvent({
                    topic: "billing.quota.exceeded",
                    dedupeKey: `billing.quota.${organizationId}.${quotaExceededDedupeBucket()}`,
                    payload: {
                        organizationId,
                        reason: error.message,
                        exceededAt: new Date().toISOString(),
                    },
                });
            } catch (enqueueError) {
                console.warn("billing.quota.exceeded_enqueue_failed", {
                    organizationId,
                    error: enqueueError instanceof Error ? enqueueError.message : String(enqueueError),
                });
            }
        }
        throw error;
    }
}
