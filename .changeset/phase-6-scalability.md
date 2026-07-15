---
"@semantask/socket": minor
"@semantask/web": minor
"@semantask/task-worker": minor
"@semantask/services": minor
"@semantask/db": patch
---

## Runtime

Phase 6 Scalability — conversation-scoped presence, retry batching, outbox partitions + Redis prod gate, Mongo index + outbox archival (Production Roadmap 6.1–6.4).

### Added

- `POST /api/internal/socket/presence-peers` and socket peer-scoped `USER_ONLINE` / `USER_OFFLINE` (TD-07)
- `TASK_RETRY_BATCH_SIZE` for multi-promote retry scanner ticks (TD-08)
- Production Redis requirement for task-worker (`TASK_WORKER_ALLOW_NO_REDIS=1` override)
- Optional `OUTBOX_PARTITION_COUNT` / `OUTBOX_PARTITION_ID` claim filter
- Message `{ conversationId, createdAt }` index
- Outbox terminal-row archival (`OUTBOX_RETENTION_DAYS`, `OUTBOX_ARCHIVE_INTERVAL_MS`)

### Fixed

- Socket stays transport-only: removed dead `message.controller.ts` (it imported `@semantask/services` validators) and dropped unused `mongoose` / `mongodb` / `bcryptjs` deps from `@semantask/socket`
