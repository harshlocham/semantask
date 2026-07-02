---
"@chat/task-worker": patch
"@chat/types": patch
---

## Runtime

Introduced feature-flagged task state divergence detection to compare the legacy lifecycle state with the projected shadow execution state.

The implementation is observability-only and does not modify runtime behavior unless `TASK_STATE_DIVERGENCE_CHECK=1` is enabled.

### Added

- Projection comparison helper
- State divergence detector
- Structured divergence logging
- Worker integration hooks
- Feature flag support
- Unit tests

### Updated

- Production runbook
- Environment documentation
- Architecture gap audit

### Compatibility

No breaking changes.

No database migrations.

No API changes.

No socket protocol changes.

Feature disabled by default.