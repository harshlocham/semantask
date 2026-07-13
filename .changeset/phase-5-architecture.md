---
"@semantask/task-worker": minor
---

## Runtime

Phase 5 Architecture Refactoring — remove dead execution path and lifecycle projection layer (Production Roadmap 5.1–5.2).

### Removed

- Dead `buildExecutionPlan` / `runExecutionPlan` path and orphan adapter helpers in `apps/task-worker/index.ts` (TD-05)

### Added

- `TASK_STATE_PROJECTION_MODE=off|shadow|enforce` (default `off`)
- `state-projection.ts`: on FSM persist, shadow-logs mismatches or enforces `lifecycleState` + `status` from `deriveLegacyLifecycleState` / `deriveLegacyTaskStatus`
- Wired into `persistShadowExecutionState` and `emitPolicyShadowState`

### Compatibility

- Default `off` preserves prior agent-runner behavior
- Policy-shadow path still aligns legacy lifecycle when mode is unset (`treatOffAs: enforce`)
