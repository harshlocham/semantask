---
"@semantask/services": minor
"@semantask/task-worker": patch
---

## Runtime

Add LLM message classifier for ingress task detection (Production Roadmap 2.1).

### Added

- `message-classifier.service` with `regex`, `shadow`, and `llm` modes (`TASK_CLASSIFIER_MODE`)
- `message-classifier-llm` in task-worker (OpenAI-compatible provider, 3s timeout, regex fallback)
- Shadow disagreement logging via `classifier.shadow.disagreement` execution events
- Unit tests for classifier modes and fallback behavior

### Updated

- `task-intelligence.service` uses async `classifyMessage()` and `aiVersion: intelligent-v4-classifier`
- `env.sample` documents classifier env vars
- Production roadmap TD-01 marked complete

### Compatibility

Default mode remains `regex` (no behavior change until `TASK_CLASSIFIER_MODE=shadow` or `llm`).
