const updateOne = jest.fn();

jest.mock("@semantask/db", () => ({
    connectToDatabase: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@semantask/db/models/OutboxEvent", () => ({
    __esModule: true,
    default: {
        updateOne: (...args: unknown[]) => updateOne(...args),
    },
}));

jest.mock("@semantask/observability", () => ({
    getActiveTraceparent: jest.fn(),
    mergeCorrelationIntoPayload: jest.fn((payload: unknown) => payload),
}));

import { releaseClaimedOutboxEvent } from "../outbox.service";

describe("releaseClaimedOutboxEvent", () => {
    beforeEach(() => updateOne.mockReset());

    test("only matches an event this worker still holds", async () => {
        updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

        await releaseClaimedOutboxEvent("event-1", "worker-1", "worker_shutdown");

        const [filter] = updateOne.mock.calls[0];
        expect(filter).toEqual({ _id: "event-1", status: "processing", lockedBy: "worker-1" });
    });

    test("makes the event available now and restores its attempt", async () => {
        updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
        const startedAt = Date.now();

        const released = await releaseClaimedOutboxEvent("event-1", "worker-1", "worker_shutdown");

        expect(released).toBe(true);
        const [, update] = updateOne.mock.calls[0];
        expect(update.$inc).toEqual({ attempts: -1 });
        expect(update.$set).toEqual({
            status: "failed",
            availableAt: expect.any(Date),
            deadLetteredAt: null,
            lockedBy: null,
            lockedAt: null,
            lastError: "worker_shutdown",
        });
        expect(update.$set.availableAt.getTime()).toBeGreaterThanOrEqual(startedAt);
        expect(update.$set.availableAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    test("reports false when the event already completed or moved on", async () => {
        updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

        await expect(releaseClaimedOutboxEvent("event-1", "worker-1", "worker_shutdown")).resolves.toBe(false);
    });
});
