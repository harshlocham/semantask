---
"@semantask/task-worker": patch
"@semantask/services": patch
---

Stop the task worker gracefully on `SIGTERM` or `SIGINT`. It finishes the current event and hands back the rest of its batch, so a deploy no longer delays claimed events by 5 minutes. `TASK_WORKER_SHUTDOWN_GRACE_MS` sets how long it waits, 20 seconds by default and at most 25. Adds `releaseClaimedOutboxEvent`, which hands an event back only while the given worker still holds it.
