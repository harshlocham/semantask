export type OutboxPartitionConfig = {
    count: number;
    id: number;
};

export function getOutboxPartitionConfig(
    env: NodeJS.ProcessEnv = process.env
): OutboxPartitionConfig {
    const rawCount = Number(env.OUTBOX_PARTITION_COUNT || 1);
    const count =
        Number.isFinite(rawCount) && rawCount > 1 ? Math.floor(rawCount) : 1;

    const rawId = Number(env.OUTBOX_PARTITION_ID || 0);
    const unclamped = Number.isFinite(rawId) ? Math.floor(rawId) : 0;
    const id = ((unclamped % count) + count) % count;

    return { count, id };
}

export function buildOutboxClaimFilter(
    now: Date,
    staleProcessingCutoff: Date,
    partition: OutboxPartitionConfig = getOutboxPartitionConfig()
): Record<string, unknown> {
    const claimable: Record<string, unknown> = {
        $or: [
            {
                status: { $in: ["pending", "failed"] },
                availableAt: { $lte: now },
            },
            {
                status: "processing",
                lockedAt: { $lte: staleProcessingCutoff },
            },
        ],
    };

    if (partition.count <= 1) {
        return claimable;
    }

    return {
        $and: [
            claimable,
            {
                $expr: {
                    $eq: [
                        { $mod: [{ $toHashedIndexKey: "$_id" }, partition.count] },
                        partition.id,
                    ],
                },
            },
        ],
    };
}

export function buildOutboxArchivalFilter(cutoff: Date): Record<string, unknown> {
    return {
        status: { $in: ["completed", "dead_letter"] },
        $or: [
            { processedAt: { $ne: null, $lte: cutoff } },
            { deadLetteredAt: { $ne: null, $lte: cutoff } },
            {
                processedAt: null,
                deadLetteredAt: null,
                updatedAt: { $lte: cutoff },
            },
        ],
    };
}
