---
"@chat/task-worker": patch
"@chat/services": patch
---

## Runtime

Hardened the retry scanner for standalone Mongo and aligned the shadow FSM on retry promote.

### Added

- Shared `isMongoTransactionUnsupported` helper (`packages/services/mongo-transaction.ts`)
- Non-transactional fallback in `runRetryScannerOnce` (mirrors `message.service.ts`)
- `emitRetryDueShadowState` for `RETRY_DUE` shadow emission when `TASK_RETRY_SHADOW_EMIT=1`
- Unit tests for transaction detection and `RETRY_DUE` transitions

### Updated

- `message.service.ts` uses shared transaction-unsupported detection
- Production runbook, gap audit (P1-4, P1-7), ADR-001/ADR-002

### Compatibility

No breaking changes.

No database migrations.

Feature flags disabled by default (`TASK_RETRY_SHADOW_EMIT`).

Standalone Mongo no longer causes `retry.scanner_failed` every tick.
