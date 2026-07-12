---
"@semantask/task-worker": patch
"@semantask/services": patch
---

## Runtime

Per-intent confidence calibration for execution policy (Production Roadmap 2.4).

### Added

- `execution-confidence` defaults + `TASK_EXECUTION_CONFIDENCE_THRESHOLDS` JSON overlay
- Policy decisions cite `semanticType`, confidence, and threshold (including `actionType: none`)
- Structured logs: `execution.policy.decision`, `false_auto_execute_risk`, `false_auto_execute`
- Unit tests for execution policy thresholds

### Updated

- Ingress outbox payload passes classifier `confidence` + `semanticType` (was hardcoding `confidence: 1`)
- Removed duplicate hardcoded `0.7` gate in worker handler; policy is authoritative

### Compatibility

Some low-confidence ingress tasks that previously auto-executed may now require approval.
