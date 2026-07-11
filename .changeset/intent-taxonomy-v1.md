---
"@semantask/types": minor
"@semantask/services": minor
"@semantask/task-worker": patch
"@semantask/web": patch
"@semantask/db": patch
---

## Runtime

Implement intent taxonomy V1 for message ingress (Production Roadmap 2.2).

### Added

- `MessageSemanticType` taxonomy: `chat`, `task`, `incident`, `scheduling`, `escalation`, `approval`, `automation`, `unknown`
- Semantic helpers (`ACTIONABLE_SEMANTIC_TYPES`, `normalizeSemanticTypeForClient`, legacy mapping)
- Classifier emits `semanticType` (regex + LLM); shadow mode compares full intents
- `IntentBadge` component in web chat UI

### Updated

- `task-intelligence.service` writes full intent; actionable intents (`task`, `scheduling`, `incident`, `automation`) auto-create tasks
- `Message` model enum expanded; legacy `decision`/`reminder` mapped on read
- `aiVersion` bumped to `intelligent-v5-intent-taxonomy`

### Compatibility

Additive enum expansion. Existing `task` and `unknown` messages remain valid. Clients tolerate unknown values via display fallback.
