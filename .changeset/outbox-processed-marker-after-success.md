---
"@semantask/task-worker": patch
---

Write the outbox processed marker only after a handler succeeds. Previously a worker crash mid-processing left the marker behind, so the reclaimed event was marked completed without being processed.
