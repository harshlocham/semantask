import { logExecution } from "./execution-logger.js";

export type WorkerShutdownOptions = {
    workerId: string;
    graceMs: number;
    /** Must restore the attempt, because stopping says nothing about the event. */
    release: (eventId: string, reason: string) => Promise<unknown>;
    exit: (code: number) => void;
};

export type WorkerShutdown = {
    isRequested: () => boolean;
    request: (signal: string) => void;
    track: (eventIds: string[]) => void;
    finished: (eventId: string) => void;
    finish: () => Promise<void>;
};

/**
 * Lets a stopping worker finish the current event and hand back the rest.
 *
 * Claimed events stay in `processing` until the 5 minute stale cutoff in
 * claimOutboxEvents, so without this every deploy delays each claimed event by
 * that long. An event released past the grace period can still be running when
 * the process exits, so it has the same duplicate safety as a crash: handlers
 * re-run, and tool idempotency keys stop repeated side effects.
 */
export function createWorkerShutdown(options: WorkerShutdownOptions): WorkerShutdown {
    const unfinished = new Set<string>();
    let requested = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let finishing: Promise<void> | null = null;

    async function releaseAndExit(): Promise<void> {
        if (timer) clearTimeout(timer);

        const eventIds = [...unfinished];
        const results = await Promise.allSettled(
            eventIds.map((eventId) => options.release(eventId, "worker_shutdown")),
        );
        const failed = results.filter((result) => result.status === "rejected").length;

        logExecution(failed > 0 ? "warn" : "info", {
            event: "worker.shutdown.complete",
            workerId: options.workerId,
            released: eventIds.length - failed,
            releaseFailed: failed,
        });
        options.exit(0);
    }

    function finish(): Promise<void> {
        finishing ??= releaseAndExit();
        return finishing;
    }

    return {
        isRequested: () => requested,
        request(signal) {
            // A second signal means do not wait.
            if (requested) {
                void finish();
                return;
            }
            requested = true;
            logExecution("info", {
                event: "worker.shutdown.requested",
                workerId: options.workerId,
                signal,
                graceMs: options.graceMs,
            });
            timer = setTimeout(() => void finish(), options.graceMs);
        },
        track(eventIds) {
            for (const eventId of eventIds) unfinished.add(eventId);
        },
        finished(eventId) {
            unfinished.delete(eventId);
        },
        finish,
    };
}
