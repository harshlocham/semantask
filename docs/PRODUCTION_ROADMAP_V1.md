# Production Roadmap V1

**Status:** Accepted  
**Last updated:** 2026-07-01  
**Owner:** Lead Architecture  
**North star:** Build a trustworthy autonomous collaboration platform — correct execution, honest intelligence, enforceable policy, observable operations.

**Baseline:** Architecture verification audit (current `main`, post-`f7886b5`). Lease-busy defer and run-independent tool idempotency are already fixed.

**Sizing:** XS (<1 day) · S (1–3 days) · M (3–7 days) · L (1–2 weeks) · XL (2–4 weeks)

---

## Phase 0 — Documentation Integrity

*Goal: Make docs a trustworthy map of runtime behavior. Zero user-facing feature change.*

### Milestone 0.1 — Architecture Doc Correction

| Field | Detail |
|-------|--------|
| **Goal** | Align `docs/ARCHITECTURE.md` with actual ingress, state, and data flows |
| **Why it matters** | Engineers make decisions from false claims (LLM classification, `MessageIntent` writes) |
| **Files involved** | `docs/ARCHITECTURE.md`, `README.md`, `docs/architecture/task-worker-execution-flow.md`, `docs/architecture/realtime-messaging-system.md` |
| **Breaking changes** | None |
| **Migration strategy** | PR-only; add verified-against-commit footer; cross-link ADRs |
| **Effort** | S |
| **Dependencies** | None |
| **Risk level** | Low |
| **Acceptance criteria** | (1) `message.created` documents regex in `packages/services/task-intelligence.service.ts`. (2) `MessageIntent` marked schema-only until Phase 2. (3) Lease-busy defer + run-independent idempotency documented. (4) No doc claims contradicted by code |

### Milestone 0.2 — Gap Audit Reconciliation

| Field | Detail |
|-------|--------|
| **Goal** | Update `docs/architecture/adr-implementation-gap-audit.md` |
| **Why it matters** | P0 items 1–2 outdated after `f7886b5` |
| **Files involved** | `docs/architecture/adr-implementation-gap-audit.md`, ADR-001, ADR-002 |
| **Breaking changes** | None |
| **Migration strategy** | Superseded-items table with commit refs; open items → Phase 1+ |
| **Effort** | XS |
| **Dependencies** | 0.1 |
| **Risk level** | Low |
| **Acceptance criteria** | Every P0/P1 marked FIXED / OPEN / DEFERRED with file evidence |

### Milestone 0.3 — Production Assumptions Runbook

| Field | Detail |
|-------|--------|
| **Goal** | Document required infra: Mongo replica set, Redis, `INTERNAL_SECRET` |
| **Why it matters** | Silent degradation on standalone Mongo / missing Redis |
| **Files involved** | `docs/operations/PRODUCTION_REQUIREMENTS.md` (new), `scripts/ci/deploy/vps-task-worker.sh`, `.github/RELEASES.md`, `docker-compose.yml` |
| **Breaking changes** | None |
| **Migration strategy** | Link from README; pre-deploy checklist in RELEASES |
| **Effort** | S |
| **Dependencies** | 0.1 |
| **Risk level** | Low |
| **Acceptance criteria** | Checklist: replica set, Redis, secrets, FSM shadow mode, email domain allowlist |

**Phase 0 release:** Docs-only. Safe anytime.

---

## Phase 1 — Runtime Correctness

*Goal: Task execution is correct, recoverable, and cancellable.*

### Milestone 1.1 — Task State Divergence Detection

| Field | Detail |
|-------|--------|
| **Goal** | Detect `lifecycleState` vs `deriveLegacyLifecycleState(executionState)` mismatch |
| **Files involved** | `packages/types/task/execution-state.ts`, `packages/db/models/Task.ts`, `apps/task-worker/services/agent-runner.ts`, `apps/task-worker/index.ts`, `execution-logger.ts` |
| **Breaking changes** | None |
| **Migration strategy** | `TASK_STATE_DIVERGENCE_CHECK=1`; log `state_diverged`; sample in prod |
| **Effort** | S |
| **Dependencies** | Phase 0 |
| **Risk level** | Low |
| **Acceptance criteria** | Divergence logged with taskId + both states; unit test; zero user regression |

### Milestone 1.2 — Policy Path Shadow FSM Alignment

| Field | Detail |
|-------|--------|
| **Goal** | Emit `POLICY_BLOCKED` / `POLICY_APPROVAL_REQUIRED` on early returns in `processTaskExecutionRequested` |
| **Files involved** | `apps/task-worker/index.ts`, `execution-state-shadow.ts`, `execution-state-machine.ts` |
| **Breaking changes** | None |
| **Migration strategy** | `TASK_POLICY_SHADOW_EMIT=1`; compare 1.1 metric before/after |
| **Effort** | M |
| **Dependencies** | 1.1 |
| **Risk level** | Medium |
| **Acceptance criteria** | Blocked/approval paths produce matching shadow kinds; divergence rate drops in staging |

### Milestone 1.3 — Retry Scanner Hardening

| Field | Detail |
|-------|--------|
| **Goal** | Standalone Mongo fallback; `RETRY_DUE` or equivalent shadow transition |
| **Files involved** | `apps/task-worker/services/retry-scheduler.ts`, `packages/services/message.service.ts`, `retry-scheduler.test.ts` |
| **Breaking changes** | None |
| **Migration strategy** | Mirror message.service transaction fallback; CI test on standalone Mongo |
| **Effort** | M |
| **Dependencies** | 1.1 |
| **Risk level** | Medium |
| **Acceptance criteria** | Scanner works on standalone Mongo; no `retry.scanner_failed` loop in CI |

### Milestone 1.4 — Task Cancellation (End-to-End)

| Field | Detail |
|-------|--------|
| **Goal** | Cancel in-flight tasks; worker honors `CANCEL_REQUESTED` → `cancelled` |
| **Files involved** | `apps/web/app/api/tasks/[id]/`, outbox, `apps/task-worker/index.ts`, `agent-runner.ts`, `lease.service.ts`, `task-panel.tsx` |
| **Breaking changes** | New API; optional outbox topic |
| **Migration strategy** | 409 if terminal; check cancel each iteration; release lease |
| **Effort** | L |
| **Dependencies** | 1.2 |
| **Risk level** | Medium |
| **Acceptance criteria** | Cancel stops tools within one iteration; terminal state; socket update; idempotent on completed |

### Milestone 1.5 — Stuck Task Remediation

| Field | Detail |
|-------|--------|
| **Goal** | `detectStuckTasksOnce` remediates, not only logs |
| **Files involved** | `apps/task-worker/services/stuck-task-detector.ts`, `schedule-retry.ts`, `lease.service.ts` |
| **Breaking changes** | Stuck tasks may auto-fail or re-enqueue |
| **Migration strategy** | `TASK_STUCK_REMEDIATION=fail\|retry\|log`; default `log` one release, then `retry` |
| **Effort** | S |
| **Dependencies** | 1.3 |
| **Risk level** | Medium |
| **Acceptance criteria** | Stale `executing` transitions within 2× heartbeat window; remediation logged |

---

## Phase 2 — AI Intelligence

*Goal: Ingress intelligence matches product promise.*

### Milestone 2.1 — LLM Message Classifier (Ingress)

| Field | Detail |
|-------|--------|
| **Goal** | Replace regex `classifyMessage()` with async LLM classifier |
| **Files involved** | `packages/services/task-intelligence.service.ts`, `apps/task-worker/services/llm/`, `Message.ts`, `apps/task-worker/index.ts` |
| **Breaking changes** | Latency on `message.created`; `aiVersion` bump |
| **Migration strategy** | Shadow: LLM + regex, log disagreement; flip `TASK_CLASSIFIER_MODE=llm` after bake-in |
| **Effort** | L |
| **Dependencies** | Phase 1 |
| **Risk level** | High |
| **Acceptance criteria** | ≥90% on 200 labeled messages; p95 < 3s; regex fallback on LLM failure |

### Milestone 2.2 — Intent Taxonomy V1

| Field | Detail |
|-------|--------|
| **Goal** | `chat`, `task`, `incident`, `scheduling`, `escalation`, `approval`, `automation` |
| **Files involved** | `message.dto.ts`, `Message.ts`, `task-intelligence.service.ts`, `socketListeners.ts`, chat UI |
| **Breaking changes** | Enum expansion; clients tolerate unknown |
| **Migration strategy** | Additive values; legacy `task` preserved; unknown → `chat` |
| **Effort** | M |
| **Dependencies** | 2.1 |
| **Risk level** | Medium |
| **Acceptance criteria** | Typed intent in DB + socket; web badge; old messages → `unknown` ✓ |

### Milestone 2.3 — MessageIntent Integration

| Field | Detail |
|-------|--------|
| **Goal** | Persist `MessageIntent` from classifier |
| **Files involved** | `packages/db/models/MessageIntent.ts`, `task-intelligence.service.ts`, `messages/[id]/semantic/route.ts` |
| **Breaking changes** | None |
| **Migration strategy** | Write on classify; expose via semantic API |
| **Effort** | M |
| **Dependencies** | 2.1, 2.2 |
| **Risk level** | Medium |
| **Acceptance criteria** | Classified messages have Intent row; API returns intent + entities ✓ |

### Milestone 2.4 — Confidence Calibration

| Field | Detail |
|-------|--------|
| **Goal** | Per-intent thresholds → `evaluateExecutionPolicy` |
| **Files involved** | `execution-policy.ts`, `task-intelligence.service.ts`, `apps/task-worker/index.ts` |
| **Breaking changes** | Some actions require approval that auto-executed before |
| **Migration strategy** | Config per intent; default 0.7; tighten after metrics |
| **Effort** | M |
| **Dependencies** | 2.2, 2.3 |
| **Risk level** | Medium |
| **Acceptance criteria** | Thresholds per intent; policy cites intent + confidence; false-auto-execute tracked ✓ |

---

## Phase 3 — Security

*Goal: Bounded, attributable, manipulation-resistant autonomous execution.*

### Milestone 3.1 — Prompt Injection Boundaries

| Field | Detail |
|-------|--------|
| **Goal** | Isolate user content; validate tool args against conversation context |
| **Files involved** | `agent-runner.ts`, `planner.ts`, new `prompt-guard.ts` |
| **Breaking changes** | Some edge tool calls blocked |
| **Migration strategy** | `TASK_PROMPT_GUARD=monitor\|enforce`; monitor 2 weeks |
| **Effort** | L |
| **Dependencies** | 2.1 |
| **Risk level** | High |
| **Acceptance criteria** | Threat model doc; injection test suite; participant validation for email/meeting ✓ |

### Milestone 3.2 — Tool RBAC V1

| Field | Detail |
|-------|--------|
| **Goal** | Per-user/conversation tool permissions before policy |
| **Files involved** | `execution-policy.ts`, `authorization.service.ts`, new `ToolGrant`, admin API |
| **Breaking changes** | Default-deny high-risk tools unless granted |
| **Migration strategy** | Grant existing users all 3 tools; admin UI for revoke |
| **Effort** | L |
| **Dependencies** | 3.1 |
| **Risk level** | High |
| **Acceptance criteria** | Block without grant; audit on deny; admin grant/revoke ✓ |

### Milestone 3.3 — Execution Audit Trail

| Field | Detail |
|-------|--------|
| **Goal** | Append-only audit log for autonomous actions |
| **Files involved** | `TaskAction.ts`, new `ExecutionAuditLog.ts`, `agent-runner.ts`, admin audit API |
| **Breaking changes** | None |
| **Migration strategy** | Dual-write TaskAction + audit |
| **Effort** | M |
| **Dependencies** | 3.2 |
| **Risk level** | Medium |
| **Acceptance criteria** | Every tool exec writes immutable audit row with actor, tool, params hash, external IDs ✓ |

### Milestone 3.4 — Internal Service Auth Hardening

| Field | Detail |
|-------|--------|
| **Goal** | Reduce `INTERNAL_SECRET` blast radius |
| **Files involved** | `internal-bridge-auth.ts`, `apps/socket/index.ts`, `apps/web/app/api/internal/`, `apps/task-worker/index.ts` |
| **Breaking changes** | Per-service secrets; deploy coordination |
| **Migration strategy** | `INTERNAL_SECRET_SOCKET` + `INTERNAL_SECRET_WORKER`; deprecate single secret over 2 releases |
| **Effort** | M |
| **Dependencies** | Phase 0 runbook |
| **Risk level** | Medium |
| **Acceptance criteria** | Worker secret cannot call socket-only endpoints; rotation runbook; zero-downtime rotation in staging ✓ |

---

## Phase 4 — Observability

*Goal: Operate autonomous execution with eyes open.*

### Milestone 4.1 — Structured Logging Unification ✓

| Field | Detail |
|-------|--------|
| **Goal** | JSON logs web + socket + worker with correlation IDs |
| **Files involved** | `execution-logger.ts`, `apps/socket/`, `apps/web/lib/`, `apps/task-worker/index.ts` |
| **Effort** | M |
| **Dependencies** | Phase 1 |
| **Acceptance criteria** | API → outbox → worker → socket traceable via `correlationId` |

### Milestone 4.2 — Metrics Export ✓

| Field | Detail |
|-------|--------|
| **Goal** | Prometheus/OpenMetrics; fix dead `/api/metrics` stub |
| **Files involved** | `llm/metrics.ts`, `performance.ts`, new metrics routes |
| **Effort** | M |
| **Dependencies** | 1.1, 4.1 |
| **Acceptance criteria** | `/metrics` scrapeable; outbox lag, task rates, LLM p95 visible |

### Milestone 4.3 — Distributed Tracing ✓

| Field | Detail |
|-------|--------|
| **Goal** | OpenTelemetry web → worker → socket → tools |
| **Effort** | L |
| **Dependencies** | 4.1 |
| **Acceptance criteria** | message→task→tool span in Jaeger/Tempo |

### Milestone 4.4 — Dashboards & Alerting ✓

| Field | Detail |
|-------|--------|
| **Goal** | SLO dashboards + alert rules |
| **Files involved** | `docs/operations/SLO.md`, `deploy/observability/` |
| **Effort** | M |
| **Dependencies** | 4.2 |
| **Acceptance criteria** | Alerts: outbox backlog, stuck tasks, failure rate > 10% |

---

## Phase 5 — Architecture Refactoring

*Goal: Reduce defect surface after correctness + observability.*

### Milestone 5.1 — Remove Dead Execution Path (XS) ✓

Delete `buildExecutionPlan` / `runExecutionPlan` in `apps/task-worker/index.ts`. No callers.

### Milestone 5.2 — Projection Layer (L) ✓

`deriveLegacyLifecycleState` at write time. `TASK_STATE_PROJECTION_MODE=shadow|enforce`.

### Milestone 5.3 — Split AgentRunner (XL) ✓

Extract `ToolExecutor`, `StepLoop`, `ShadowFsmWriter`, `ClarificationHandler`. Target <800 LOC facade.

### Milestone 5.4 — Workflow Engine Boundaries (XL) ✓

`WorkflowTemplate` interface; route intents to templates. Default = current agent loop.

---

## Phase 6 — Scalability

### 6.1 Presence Optimization (M) — conversation-scoped presence  
### 6.2 Retry Scanner Throughput (S) — batch promotion  
### 6.3 Outbox / Queue Scaling (L) — require Redis; partition workers  
### 6.4 Mongo Optimizations (M) — indexes, outbox archival  

---

## Phase 7 — Enterprise

### 7.1 Organizations & Tenants (XL)  
### 7.2 Policy Engine (L)  
### 7.3 Quotas & Billing Hooks (XL)  

Defer until Phases 1–4 complete.

---

## Critical Path

```
Phase 0 → 1.1–1.3 → 2.1–2.2 → 3.1–3.2 → 4.1–4.2 → 1.4 → 5.2
```

**Minimum credible autonomous bar:** 2.1 + 3.1 + 3.2 + 4.2 complete before marketing "autonomous."

---

## Technical Debt Register

| ID | Debt | Location | Phase |
|----|------|----------|-------|
| TD-01 | LLM ingress classifier (`TASK_CLASSIFIER_MODE=regex\|shadow\|llm`; regex fallback) | `message-classifier.service.ts`, `message-classifier-llm.ts` | 2.1 ✓ |
| TD-02 | ARCHITECTURE.md false LLM/MessageIntent claims | `docs/ARCHITECTURE.md` | 0.1 |
| TD-03 | Dual task state without projection | `Task.ts`, `agent-runner.ts` | 1.1, 5.2 ✓ |
| TD-04 | MessageIntent persisted from classifier (`message-intent.service`) | `MessageIntent.ts`, `task-intelligence.service.ts` | 2.3 ✓ |
| TD-05 | Dead buildExecutionPlan | `index.ts` | 5.1 ✓ |
| TD-06 | AgentRunner monolith (3223 LOC) | `agent-runner.ts` | 5.3 ✓ |
| TD-07 | Global presence fan-out | `presence.handler.ts` | 6.1 |
| TD-08 | Retry scanner serial + txn-only | `retry-scheduler.ts` | 1.3, 6.2 |
| TD-09 | No `/api/metrics` route | `performance.ts` | 4.2 |
| TD-10 | Stuck detector log-only | `stuck-task-detector.ts` | 1.5 |
| TD-11 | Cancellation FSM unwired | `execution-state-machine.ts` | 1.4 |
| TD-12 | Gap audit stale P0s | `adr-implementation-gap-audit.md` | 0.2 (reconciled 2026-07-01) |

---

## 90-Day Plan (Summary)

| Weeks | Milestones |
|-------|------------|
| 1–2 | 0.1–0.3, 5.1, 1.1, 1.5 |
| 3–5 | 1.2, 1.3, 1.4 |
| 6–8 | 2.1 shadow, 2.2, 2.3, 4.1 |
| 9–11 | 3.1, 4.2, 3.2, 2.4 |
| 12–13 | 3.3, 4.4, 5.2 shadow start |

**Deferred past 90 days:** Phase 7, 4.3

---

## Verification References

- Architecture verification audit (2026-07-01)
- Fixed in `f7886b5`: lease-busy defer, run-independent tool idempotency
- Production readiness score at roadmap acceptance: **42/100** (vision-weighted)

## Note 
This roadmap represents the intended evolution of the platform. Priorities may change based on production feedback, community contributions, and newly discovered architectural constraints.