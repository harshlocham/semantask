import { logExecution } from "./execution-logger.js";

// v2: older keys were written before processing, so they do not prove success.
const PROCESSED_KEY_PREFIX = "task-worker:processed:v2:";
const PROCESSED_TTL_SECONDS = 7 * 24 * 60 * 60;

export type ProcessedMarkerStore = {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
};

export function processedMarkerKey(dedupeKey: string): string {
    return `${PROCESSED_KEY_PREFIX}${dedupeKey}`;
}

/**
 * Runs an outbox handler, then records success and completes the event.
 *
 * The marker is written only after the handler succeeds, so a crash mid-handler
 * leaves nothing behind and the reclaimed event runs again. Handlers must stay
 * duplicate-safe, because a crash after the handler but before the marker also
 * re-runs them. A crash after the marker skips straight to completing the event.
 */
export async function processOutboxEventOnce(input: {
    store: ProcessedMarkerStore | null;
    dedupeKey: string;
    workerId: string;
    handle: () => Promise<void>;
    complete: () => Promise<void>;
}): Promise<void> {
    const key = processedMarkerKey(input.dedupeKey);

    if (input.store && await input.store.get(key)) {
        await input.complete();
        return;
    }

    await input.handle();

    if (input.store) {
        try {
            await input.store.set(key, input.workerId, "EX", PROCESSED_TTL_SECONDS);
        } catch (error) {
            // The work is done and completing below is the durable record.
            logExecution("warn", {
                event: "outbox.processed_marker.write_failed",
                workerId: input.workerId,
                dedupeKey: input.dedupeKey,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    await input.complete();
}
