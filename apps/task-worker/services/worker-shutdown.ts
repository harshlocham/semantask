import { logExecution } from "./execution-logger.js";

export type WorkerShutdownOptions = {
    workerId: string;
    graceMs: number;
    /**
     * Must restore the attempt, because stopping says nothing about the event.
     * Resolves false when the event was no longer held, such as one that just completed.
     */
    release: (eventId: string, reason: string) => Promise<boolean>;
    exit: (code: number) => void;
};

export type WorkerShutdown = {
    isRequested: () => boolean;
    request: (signal: string) => void;
    /** Tracks a claim before it resolves, so a shutdown mid-claim still hands its events back. */
    claim: <T>(pending: Promise<T[]>, idOf: (event: T) => string) => Promise<T[]>;
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
    let pendingClaim: Promise<unknown> | null = null;

    async function releaseAndExit(): Promise<void> {
        if (timer) clearTimeout(timer);
        if (pendingClaim) await pendingClaim;

        const eventIds = [...unfinished];
        const results = await Promise.allSettled(
            eventIds.map((eventId) => options.release(eventId, "worker_shutdown")),
        );
        const failed = results.filter((result) => result.status === "rejected").length;
        const notHeld = results.filter((result) => result.status === "fulfilled" && result.value === false).length;

        logExecution(failed > 0 ? "warn" : "info", {
            event: "worker.shutdown.complete",
            workerId: options.workerId,
            released: eventIds.length - failed - notHeld,
            notHeld,
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
        async claim(pending, idOf) {
            const tracked = pending.then((events) => {
                for (const event of events) unfinished.add(idOf(event));
                return events;
            });
            pendingClaim = tracked.catch(() => undefined);
            try {
                return await tracked;
            } finally {
                pendingClaim = null;
            }
        },
        finished(eventId) {
            unfinished.delete(eventId);
        },
        finish,
    };
}
