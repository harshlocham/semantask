import { archiveTerminalOutboxEvents } from "@semantask/services/outbox.service";

const ARCHIVE_INTERVAL_MS = Number(process.env.OUTBOX_ARCHIVE_INTERVAL_MS || 60 * 60 * 1000);

/**
 * Periodically deletes completed / dead-letter outbox rows older than
 * OUTBOX_RETENTION_DAYS. Returns a stop handle.
 */
export function startOutboxArchivalJob(workerId: string): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const intervalMs =
        Number.isFinite(ARCHIVE_INTERVAL_MS) && ARCHIVE_INTERVAL_MS > 0
            ? ARCHIVE_INTERVAL_MS
            : 60 * 60 * 1000;

    const tick = async () => {
        if (stopped) {
            return;
        }

        try {
            const deleted = await archiveTerminalOutboxEvents();
            if (deleted > 0) {
                console.info("task-worker outbox.archived", {
                    workerId,
                    deleted,
                });
            }
        } catch (error) {
            console.error("task-worker outbox.archive_failed", {
                workerId,
                error: error instanceof Error ? error.message : String(error),
            });
        }

        if (!stopped) {
            timer = setTimeout(() => {
                void tick();
            }, intervalMs);
        }
    };

    void tick();

    return () => {
        stopped = true;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };
}
