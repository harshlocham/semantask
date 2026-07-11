---
"@semantask/services": minor
"@semantask/web": patch
---

## Runtime

Persist MessageIntent rows from classification (Production Roadmap 2.3).

### Added

- `message-intent.service` with semantic→speech-act mapper, heuristic entity extract, and upsert by `messageId`
- `GET /api/messages/:id/semantic` returns message semantic fields + `intent`
- Intent write on every classify path in `task-intelligence.service`

### Updated

- `PATCH /api/messages/:id/semantic` upserts Intent on manual override
- `aiVersion` bumped to `intelligent-v6-message-intent`
- Roadmap TD-04 (orphaned MessageIntent) resolved

### Compatibility

No breaking API changes. MessageIntent uses existing speech-act enum; product taxonomy remains on `Message.semanticType`.
