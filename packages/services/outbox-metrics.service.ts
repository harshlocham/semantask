import OutboxEventModel from "@semantask/db/models/OutboxEvent";
import {
    outboxLagSecondsGauge,
    outboxPendingGauge,
    outboxProcessingGauge,
} from "@semantask/observability/metrics";

const TOPICS = [
    "message.created",
    "task.created",
    "task.updated",
    "task.execution.requested",
    "task.execution.approved",
    "task.cancel.requested",
] as const;

/**
 * Refresh outbox backlog gauges from Mongo. Call periodically from the worker.
 */
export async function refreshOutboxMetrics(): Promise<void> {
    const now = Date.now();

    for (const topic of TOPICS) {
        const [pendingCount, processingCount, oldestPending] = await Promise.all([
            OutboxEventModel.countDocuments({
                topic,
                status: { $in: ["pending", "failed"] },
                availableAt: { $lte: new Date(now) },
            }),
            OutboxEventModel.countDocuments({
                topic,
                status: "processing",
            }),
            OutboxEventModel.findOne({
                topic,
                status: { $in: ["pending", "failed"] },
                availableAt: { $lte: new Date(now) },
            })
                .sort({ createdAt: 1 })
                .select({ createdAt: 1 })
                .lean(),
        ]);

        outboxPendingGauge.set({ topic }, pendingCount);
        outboxProcessingGauge.set({ topic }, processingCount);

        if (oldestPending?.createdAt) {
            const lagSeconds = Math.max(
                0,
                (now - new Date(oldestPending.createdAt).getTime()) / 1000
            );
            outboxLagSecondsGauge.set({ topic }, lagSeconds);
        } else {
            outboxLagSecondsGauge.set({ topic }, 0);
        }
    }
}
