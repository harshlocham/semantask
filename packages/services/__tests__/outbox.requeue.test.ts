const countDocuments = jest.fn();
const updateMany = jest.fn();

jest.mock("@semantask/db", () => ({
    connectToDatabase: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@semantask/db/models/OutboxEvent", () => ({
    __esModule: true,
    default: {
        countDocuments: (...args: unknown[]) => countDocuments(...args),
        updateMany: (...args: unknown[]) => updateMany(...args),
    },
}));

jest.mock("@semantask/observability", () => ({
    getActiveTraceparent: jest.fn(),
    mergeCorrelationIntoPayload: jest.fn((payload: unknown) => payload),
}));

import { requeueDeadLetteredMessageEvents } from "../outbox.service";

const FILTER = { topic: "message.created", status: "dead_letter" };

describe("requeueDeadLetteredMessageEvents", () => {
    test("dry run counts matching events and writes nothing", async () => {
        countDocuments.mockResolvedValue(3);

        const result = await requeueDeadLetteredMessageEvents({ dryRun: true });

        expect(result).toEqual({ dryRun: true, matched: 3, requeued: 0 });
        expect(countDocuments).toHaveBeenCalledWith(FILTER);
        expect(updateMany).not.toHaveBeenCalled();
    });

    test("moves only dead-lettered message.created events back to pending with attempts reset", async () => {
        updateMany.mockResolvedValue({ matchedCount: 2, modifiedCount: 2 });
        const startedAt = Date.now();

        const result = await requeueDeadLetteredMessageEvents();

        expect(result).toEqual({ dryRun: false, matched: 2, requeued: 2 });
        expect(countDocuments).not.toHaveBeenCalled();
        expect(updateMany).toHaveBeenCalledTimes(1);

        const [filter, update] = updateMany.mock.calls[0];
        expect(filter).toEqual(FILTER);
        expect(update.$set).toEqual({
            status: "pending",
            attempts: 0,
            availableAt: expect.any(Date),
            processedAt: null,
            deadLetteredAt: null,
            lockedBy: null,
            lockedAt: null,
            lastError: null,
        });
        expect(update.$set.availableAt.getTime()).toBeGreaterThanOrEqual(startedAt);
    });
});
