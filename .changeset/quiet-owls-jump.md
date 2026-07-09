---
"@semantask/task-worker": patch
"@semantask/web": patch
"@semantask/db": patch
"@semantask/types": patch
"@semantask/services": patch
---

## Runtime

Implemented end-to-end task cancellation from the web API through the outbox to the task worker and agent runner.

### Added

- `POST /api/tasks/:id/cancel` API (409 on terminal tasks; idempotent when already requested)
- `task.cancel.requested` outbox topic
- `task-cancellation` service (`CANCEL_REQUESTED` / `CANCEL_FINALIZED` shadow + legacy finalize)
- Per-iteration cancellation checks in `AgentRunner`
- Cancel button in task panel
- Unit tests

### Updated

- Task model (`cancelRequestedAt`, `cancelReason`, …)
- Gap audit (P3-12)

### Compatibility

No breaking changes to existing APIs.

Cancellation is idempotent on terminal tasks (409) and duplicate cancel requests (200).

Legacy `lifecycleState` remains `failed` for cancelled tasks (FSM `cancelled` projection).
