---
"@semantask/services": minor
"@semantask/observability": minor
"@semantask/task-worker": patch
---

Harden classifier shadow metrics/isolation, add assignee/due heuristics, and ship a labeled evaluation harness. Production default remains `TASK_CLASSIFIER_MODE=regex`.

### Added
- `classifier_classifications_total{mode,source}`; disagreement counter labels `{regex_type,llm_type}`
- Failure-isolated disagreement hooks; shadow LLM failures cannot break classification
- Deterministic assignee (@mention/email) + due-date heuristics → MessageIntent / WorkSuggestion candidates
- Extractor version `intelligent-v7-entity-heuristics`
- Seed gold eval harness (`packages/services/eval/`) with CI gate (≥0.7 type accuracy)

### Compatibility
- `regex` remains default authority; shadow never alters product path or execution
