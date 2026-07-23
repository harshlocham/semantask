# @semantask/services

## 3.2.0

### Minor Changes

- c280792: ## Runtime

  Phase 6 Scalability — conversation-scoped presence, retry batching, outbox partitions + Redis prod gate, Mongo index + outbox archival (Production Roadmap 6.1–6.4).

  ### Added
  - `POST /api/internal/socket/presence-peers` and socket peer-scoped `USER_ONLINE` / `USER_OFFLINE` (TD-07)
  - `TASK_RETRY_BATCH_SIZE` for multi-promote retry scanner ticks (TD-08)
  - Production Redis requirement for task-worker (`TASK_WORKER_ALLOW_NO_REDIS=1` override)
  - Optional `OUTBOX_PARTITION_COUNT` / `OUTBOX_PARTITION_ID` claim filter
  - Message `{ conversationId, createdAt }` index
  - Outbox terminal-row archival (`OUTBOX_RETENTION_DAYS`, `OUTBOX_ARCHIVE_INTERVAL_MS`)

  ### Fixed
  - Socket stays transport-only: removed dead `message.controller.ts` (it imported `@semantask/services` validators) and dropped unused `mongoose` / `mongodb` / `bcryptjs` deps from `@semantask/socket`

- 44aa330: Enterprise — personal workspace + optional organizations, org policy overlays, usage metering and quotas

  ### Added
  - `Organization` / `OrganizationMembership` with owner|admin|member roles
  - Optional `organizationId` on Conversation, Task, ToolGrant, ExecutionAuditLog
  - `OrganizationPolicy`, `OrganizationQuota`, `UsageEvent`
  - Org CRUD/members/policy/quota APIs; `X-Organization-Id` context; ADR-004
  - Execution policy + ToolGrant org overlays; billing outbox topics + `/api/internal/billing/events`

### Patch Changes

- Updated dependencies [c280792]
- Updated dependencies [44aa330]
  - @semantask/db@3.2.0

## 3.1.0

### Minor Changes

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

- e0f352b: ## Runtime

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

- Updated dependencies [6343a6f]
- Updated dependencies [1308ef0]
- Updated dependencies [4a0b104]
- Updated dependencies [8049e1b]
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

- Updated dependencies [3842f81]
- Updated dependencies [fe46888]
  - @semantask/types@2.0.0
  - @semantask/db@3.0.0

## 2.0.3

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

## 2.0.2

### Patch Changes

- 51f6a45: Hardened realtime authorization and internal communication architecture across the platform. Refactored the socket server into a transport-only layer using secure internal web authorization bridges, centralized conversation/task ACL enforcement, server-resolved participant fan-out, and mandatory INTERNAL_SECRET validation. Added shared authorization services for REST and socket flows, removed client-trusted recipient authorization paths, restricted unsafe task status mutations, and improved overall security consistency for realtime messaging and task execution.
- Updated dependencies [51f6a45]
  - @semantask/db@2.0.3

## 2.0.1

### Patch Changes

- e3ad385: The system has been fully implemented to support multi-step execution with strict safety and hallucination prevention.d it can self-heal a failed tool execution by asking the LLM for a corrected decision before falling back to normal retry behavior. The planner now preserves step input/output from LLM plans and explicitly asks for template-ready step context
- Updated dependencies [e3ad385]
  - @semantask/types@1.3.1
  - @semantask/db@2.0.2

## 2.0.0

### Major Changes

- 8a4de46: Added task management across the stack, including shared task models/types, task APIs and socket events, a real-time task panel in the web app, and an outbox-driven worker for task intelligence and execution.

### Patch Changes

- Updated dependencies [8a4de46]
  - @semantask/db@2.0.0
  - @semantask/types@1.3.0

## 1.1.0

### Minor Changes

- 3215a80: Enhanced mobile authentication and chat session management, and standardized monorepo build tooling across shared packages.
  - Added mobile auth support improvements and session flow hardening.
  - Added explicit build scripts/config for shared packages (auth, db, services, redis, types) to emit dist artifacts consistently.
  - Improved repository cleanup scripts with safer artifact cleanup and full-reset options.
  - Updated Turbo build outputs for better Next.js build caching behavior.

### Patch Changes

- Updated dependencies [3215a80]
  - @semantask/types@1.1.0

## 1.0.3

### Patch Changes

- 86f8cfe: Refactor CI/CD to use Changesets-native package tags for deployment
  - Removed root `v*` tag creation logic from release workflow
  - Updated deploy workflow to trigger on Changesets tags (`@semantask/services@*`)
  - Implemented strict tag parsing and validation
  - Added package-specific deployment gating
  - Improved Docker tagging and metadata extraction
  - Enforced PAT usage for reliable workflow chaining

- Updated dependencies [86f8cfe]
  - @semantask/types@1.0.3

## 1.0.2

### Patch Changes

- 86f8cfe: Fix release workflow to create root version tags for deploy trigger
  - **release.yml**: Add step to create root repository version tag (v\*) based on highest package version
  - **deploy.yml compatibility**: Root v\* tags now enable proper deployment workflow triggering
  - This resolves the issue where release workflow created only package-scoped tags but deploy workflow needed root tags

- Updated dependencies [86f8cfe]
  - @semantask/types@1.0.2

## 1.0.1

### Patch Changes

- 3b307d2: Fix CI/CD release and deployment pipeline configuration
  - **release.yml**: Fix publish step to actually create git tags using `npx changeset tag` instead of echo fallback
  - **release.yml**: Add robust token fallback (`CHANGESETS_GITHUB_TOKEN || GITHUB_TOKEN`) for private repo releases
  - **deploy.yml**: Relax actor gate to allow repository owner to trigger deployments from token-based releases
  - **deploy.yml**: Add comprehensive deployment provenance validation (semver format, commit ancestry, GitHub Release verification)
  - **deploy.yml**: Add timeout configurations and improve error handling for staging/production builds

  These fixes ensure the automated release pipeline correctly creates version tags and the deployment workflow is properly triggered, enabling end-to-end CI/CD automation for the monorepo.

- Updated dependencies [3b307d2]
  - @semantask/types@1.0.1
