/**
 * Move dead-lettered message.created outbox events back to pending with attempts
 * reset. Fix the cause first: events that fail again dead-letter again.
 * Events older than OUTBOX_RETENTION_DAYS are already deleted.
 *
 * Usage (MONGODB_URI set):
 *   pnpm --filter @semantask/task-worker requeue:dead-letter-messages --dry-run
 *   pnpm --filter @semantask/task-worker requeue:dead-letter-messages
 */
import "../config/env.js";
import { requeueDeadLetteredMessageEvents } from "@semantask/services/outbox.service";

async function main(): Promise<void> {
    const dryRun = process.argv.includes("--dry-run");
    const result = await requeueDeadLetteredMessageEvents({ dryRun });
    console.log(JSON.stringify(result, null, 2));

    if (dryRun) {
        console.log("Dry run only. Re-run without --dry-run to requeue.");
    }
}

main()
    .catch((error) => {
        console.error(
            "requeue-dead-letter-messages failed:",
            error instanceof Error ? error.message : String(error),
        );
        process.exitCode = 1;
    })
    .finally(() => {
        process.exit();
    });
