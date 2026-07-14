# @semantask/task-worker

## 3.1.0

### Minor Changes

- 1308ef0: ## Runtime

  Phase 3 Security — prompt injection boundaries, tool RBAC, execution audit trail, and per-service internal secrets (Production Roadmap 3.1–3.4).

  ### Added
  - Prompt guard (`TASK_PROMPT_GUARD=off|monitor|enforce`) with untrusted content fencing and participant/contact validation for email/meeting tools
  - `ToolGrant` model + admin grant/revoke/seed API and UI; `TASK_TOOL_RBAC=off|enforce`
  - Append-only `ExecutionAuditLog` dual-write on tool start/complete/deny/approval + `GET /api/admin/execution-audit`
  - Per-service secrets: `INTERNAL_SECRET_SOCKET` / `INTERNAL_SECRET_WORKER` (+ `*_PREVIOUS` rotation) with legacy `INTERNAL_SECRET` fallback
  - Threat model doc, rotation runbook, and unit tests

  ### Updated
  - Planner and agent-runner fence task title/description before LLM calls
  - Execution policy and agent execute path enforce prompt-guard + tool grants
  - Socket and web internal bridges use audience-aware secret validation
  - Production requirements / roadmap acceptance for 3.1–3.4

  ### Compatibility
  - Prompt guard and tool RBAC default to `off`; enable after staging monitor / grant seed
  - Legacy `INTERNAL_SECRET` still accepted on both audiences during the deprecation window
  - When distinct secrets are active (no legacy fallback), the socket secret (`INTERNAL_SECRET_SOCKET`) alone cannot authorize web `/api/internal/*`

- 4a0b104: ## Runtime

  Phase 4 Observability — structured correlation logs, Prometheus metrics, OpenTelemetry foundation, and SLO alerts (Production Roadmap 4.1–4.4).

  ### Added
  - `@semantask/observability` package: JSON logger + ALS `correlationId`, Prometheus registry, OTLP tracing bootstrap
  - Outbox payloads carry `correlationId` (and `traceparent` when tracing); worker binds ALS on claim; `x-correlation-id` on internal bridges
  - Scrape endpoints: web `GET /api/metrics`, socket `GET /metrics`, worker `METRICS_PORT` `/metrics`; RUM moved to `POST /api/metrics/rum`
  - Manual spans `message.created` → `task.execution` → `tool.execute` when `OTEL_EXPORTER_OTLP_ENDPOINT` is set
  - `docs/operations/SLO.md` and `deploy/observability/` Prometheus/alerts/Grafana assets

  ### Updated
  - Task-worker execution logger wraps shared JSON logger; LLM metrics dual-write histogram/counters
  - Production roadmap Phase 4 milestones marked complete

- 5df0c20: ## Runtime

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

### Patch Changes

- ac9bb5f: ## Runtime

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

- 6343a6f: ## Runtime

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

- dcb50e2: ## Runtime

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

- 8049e1b: ## Runtime

  Implemented end-to-end task cancellation from the web API through the outbox to the task worker and agent runner.

  ### Added
  - `POST /api/tasks/:id/cancel` API (409 on terminal tasks; idempotent when already requested)
  - `task.cancel.requested` outbox topic
  - `task-cancellation` service (`CANCEL_REQUESTED` / `CANCEL_FINALIZED` shadow + legacy finalize)
  - Per-iteration cancellation checks in `AgentRunner`
  - Cancel button in task panel
  - Unit tests

  ### Updated
  - Task model (`cancelRequestedAt`, `cancelReason`, …)
  - Gap audit (P3-12)

  ### Compatibility

  No breaking changes to existing APIs.

  Cancellation is idempotent on terminal tasks (409) and duplicate cancel requests (200).

  Legacy `lifecycleState` remains `failed` for cancelled tasks (FSM `cancelled` projection).

- Updated dependencies [ac9bb5f]
- Updated dependencies [6343a6f]
- Updated dependencies [dcb50e2]
- Updated dependencies [e0f352b]
- Updated dependencies [1308ef0]
- Updated dependencies [4a0b104]
- Updated dependencies [8049e1b]
  - @semantask/services@3.1.0
  - @semantask/types@2.1.0
  - @semantask/db@3.1.0
  - @semantask/observability@1.1.0

## 3.0.1

### Patch Changes

- 4818bb5: ## Runtime

  Hardened the retry scanner for standalone Mongo and aligned the shadow FSM on retry promote.

  ### Added
  - Shared `isMongoTransactionUnsupported` helper (`packages/services/mongo-transaction.ts`)
  - Non-transactional fallback in `runRetryScannerOnce` (mirrors `message.service.ts`)
  - `emitRetryDueShadowState` for `RETRY_DUE` shadow emission when `TASK_RETRY_SHADOW_EMIT=1`
  - Unit tests for transaction detection and `RETRY_DUE` transitions

  ### Updated
  - `message.service.ts` uses shared transaction-unsupported detection
  - Production runbook, gap audit (P1-4, P1-7), ADR-001/ADR-002

  ### Compatibility

  No breaking changes.

  No database migrations.

  Feature flags disabled by default (`TASK_RETRY_SHADOW_EMIT`).

  Standalone Mongo no longer causes `retry.scanner_failed` every tick.

- Updated dependencies [4818bb5]
  - @semantask/services@3.0.1

## 3.0.0

### Major Changes

- fe46888: Rebrand from chat-app / @chat to Semantask / @semantask.
  - Product name: AgentMesh AI → Semantask
  - npm scope: @chat/_ → @semantask/_
  - Default MongoDB database: chat-app → semantask
  - VPS deploy path example: /opt/chat-app → /opt/semantask

  Breaking for anyone still importing @chat/\* or using the old DB/deploy paths.
  Existing Mongo data in `chat-app` is unchanged; update MONGODB_URI or migrate data.

### Patch Changes

- 3842f81: ## Runtime

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

- 7d2f690: ## Runtime

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

- Updated dependencies [3842f81]
- Updated dependencies [fe46888]
  - @semantask/types@2.0.0
  - @semantask/services@3.0.0
  - @semantask/db@3.0.0

## 2.0.6

### Patch Changes

- 072fafc: - Introduced markOutboxEventDeferred function to handle event deferral in case of execution lease conflicts.
  - Updated task processing logic to defer events when an ExecutionLeaseBusyError occurs.
  - Enhanced outbox function retrieval to include the new defer functionality.
  - Removed unnecessary runId references in agent-runner for improved idempotency.
  - Added tests to verify the behavior of event deferral and its impact on claim attempts.
- 4a29cb5: Enhance execution lease management and task processing.
  - Added execution lease validation before task processing begins.
  - Improved handling of lease contention with a dedicated execution lease busy error.
  - Refined task action ID generation for more consistent task tracking.
  - Cleaned up task-related API code and removed unused imports.

- Updated dependencies [072fafc]
- Updated dependencies [4a29cb5]
  - @semantask/services@2.0.3

## 2.0.5

### Patch Changes

- 51f6a45: Hardened realtime authorization and internal communication architecture across the platform. Refactored the socket server into a transport-only layer using secure internal web authorization bridges, centralized conversation/task ACL enforcement, server-resolved participant fan-out, and mandatory INTERNAL_SECRET validation. Added shared authorization services for REST and socket flows, removed client-trusted recipient authorization paths, restricted unsafe task status mutations, and improved overall security consistency for realtime messaging and task execution.
- Updated dependencies [51f6a45]
  - @semantask/services@2.0.2
  - @semantask/db@2.0.3

## 2.0.4

### Patch Changes

- 5a2cba8: - Socket: register message:send handlers; broadcast online status on connect; remove duplicate join/leave handlers
  - Web: connect socket after login/register without reload; stop disconnecting on tab visibility changes
  - Mobile: reconnect on app foreground instead of disconnecting in background
  - Task worker: use @semantask/services package imports so production start resolves modules correctly
  - Root: Next 15.5.18 override, uuid 14, ESLint config baseDirectory for apps/web

## 2.0.3

### Patch Changes

- 8e3ed9a: Introduce LLM provider abstraction: pluggable providers, shared interfaces, and cleaner configuration.

## 2.0.2

### Patch Changes

- dc73990: task-worker: unify LLM boundary, preserve step IO, add self-heal and clarification flows; redact policy decisions and improve execution updates
- Updated dependencies [dc73990]
  - @semantask/types@1.3.2

## 2.0.1

### Patch Changes

- e3ad385: The system has been fully implemented to support multi-step execution with strict safety and hallucination prevention.d it can self-heal a failed tool execution by asking the LLM for a corrected decision before falling back to normal retry behavior. The planner now preserves step input/output from LLM plans and explicitly asks for template-ready step context
- Updated dependencies [e3ad385]
  - @semantask/services@2.0.1
  - @semantask/types@1.3.1
  - @semantask/db@2.0.2

## 2.0.0

### Major Changes

- 8a4de46: Added task management across the stack, including shared task models/types, task APIs and socket events, a real-time task panel in the web app, and an outbox-driven worker for task intelligence and execution.

### Patch Changes

- Updated dependencies [8a4de46]
  - @semantask/services@2.0.0
  - @semantask/db@2.0.0
  - @semantask/types@1.3.0
