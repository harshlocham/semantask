import {
    buildOutboxArchivalFilter,
    buildOutboxClaimFilter,
    getOutboxPartitionConfig,
} from "../outbox.helpers";

describe("outbox.helpers partition + archival", () => {
    describe("getOutboxPartitionConfig", () => {
        test("defaults to single partition", () => {
            expect(getOutboxPartitionConfig({})).toEqual({ count: 1, id: 0 });
        });

        test("normalizes partition id into range", () => {
            expect(
                getOutboxPartitionConfig({
                    OUTBOX_PARTITION_COUNT: "4",
                    OUTBOX_PARTITION_ID: "5",
                })
            ).toEqual({ count: 4, id: 1 });
        });
    });

    describe("buildOutboxClaimFilter", () => {
        const now = new Date("2026-07-15T12:00:00.000Z");
        const stale = new Date("2026-07-15T11:55:00.000Z");

        test("omits partition expr when count is 1", () => {
            const filter = buildOutboxClaimFilter(now, stale, { count: 1, id: 0 });
            expect(filter.$and).toBeUndefined();
            expect(filter.$or).toBeDefined();
        });

        test("adds hashed _id partition expr when count > 1", () => {
            const filter = buildOutboxClaimFilter(now, stale, { count: 3, id: 2 });
            expect(filter).toEqual({
                $and: [
                    {
                        $or: [
                            {
                                status: { $in: ["pending", "failed"] },
                                availableAt: { $lte: now },
                            },
                            {
                                status: "processing",
                                lockedAt: { $lte: stale },
                            },
                        ],
                    },
                    {
                        $expr: {
                            $eq: [
                                { $mod: [{ $toHashedIndexKey: "$_id" }, 3] },
                                2,
                            ],
                        },
                    },
                ],
            });
        });
    });

    describe("buildOutboxArchivalFilter", () => {
        test("targets only terminal statuses with aged timestamps", () => {
            const cutoff = new Date("2026-07-01T00:00:00.000Z");
            expect(buildOutboxArchivalFilter(cutoff)).toEqual({
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
            });
        });
    });
});
