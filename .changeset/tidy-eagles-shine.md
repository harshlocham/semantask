---
"@chat/task-worker": patch
---

## Runtime

Aligned the shadow execution FSM with the legacy lifecycle on the policy early-return paths of `processTaskExecutionRequested`.

When `TASK_POLICY_SHADOW_EMIT=1` (and FSM shadow mode is on), the blocked and approval-required paths now emit `POLICY_BLOCKED` / `POLICY_APPROVAL_REQUIRED` shadow events and write an aligned legacy `lifecycleState` (the FSM projection), so dual-state stays consistent instead of leaving the shadow FSM stale.

### Added

- `emitPolicyShadowState` helper (policy-shadow.ts)
- `POLICY_BLOCKED` / `POLICY_APPROVAL_REQUIRED` shadow emission on policy early returns
- `APPROVAL_GRANTED` resume in `startShadowExecutionRun` for approved re-runs
- Feature flag `TASK_POLICY_SHADOW_EMIT`
- Unit tests

### Updated

- Production runbook
- Environment documentation
- Architecture gap audit (P1-6)

### Compatibility

No breaking changes.

No database migrations.

No API changes.

No socket protocol changes.

Feature disabled by default.
