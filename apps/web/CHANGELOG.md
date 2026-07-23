# @semantask/web

## 5.2.0

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
  - @semantask/services@3.2.0

## 5.1.0

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

### Patch Changes

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
  - @semantask/observability@1.1.0

## 5.0.1

### Patch Changes

- Updated dependencies [4818bb5]
  - @semantask/services@3.0.1

## 5.0.0

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
  - @semantask/services@3.0.0
  - @semantask/auth@3.0.0

## 4.0.5

### Patch Changes

- 5eece69: Fix authentication and step-up flows:
  - @semantask/auth: Block token refresh while a session is step_up_pending so challenges stay valid through verification
  - @semantask/web: Reset auth bootstrap after login, register, and step-up completion
  - @semantask/web: Prevent duplicate refresh and OTP send requests that caused 429 rate limits
  - @semantask/web: Handle unauthenticated API calls without throwing after bootstrap

- 4a29cb5: Enhance execution lease management and task processing.
  - Added execution lease validation before task processing begins.
  - Improved handling of lease contention with a dedicated execution lease busy error.
  - Refined task action ID generation for more consistent task tracking.
  - Cleaned up task-related API code and removed unused imports.

- Updated dependencies [9040db3]
- Updated dependencies [072fafc]
- Updated dependencies [ac01b5e]
- Updated dependencies [5eece69]
- Updated dependencies [4a29cb5]
  - @semantask/auth@2.3.3
  - @semantask/services@2.0.3

## 4.0.4

### Patch Changes

- 51f6a45: Hardened realtime authorization and internal communication architecture across the platform. Refactored the socket server into a transport-only layer using secure internal web authorization bridges, centralized conversation/task ACL enforcement, server-resolved participant fan-out, and mandatory INTERNAL_SECRET validation. Added shared authorization services for REST and socket flows, removed client-trusted recipient authorization paths, restricted unsafe task status mutations, and improved overall security consistency for realtime messaging and task execution.
- Updated dependencies [51f6a45]
  - @semantask/services@2.0.2

## 4.0.3

### Patch Changes

- 5a2cba8: - Socket: register message:send handlers; broadcast online status on connect; remove duplicate join/leave handlers
  - Web: connect socket after login/register without reload; stop disconnecting on tab visibility changes
  - Mobile: reconnect on app foreground instead of disconnecting in background
  - Task worker: use @semantask/services package imports so production start resolves modules correctly
  - Root: Next 15.5.18 override, uuid 14, ESLint config baseDirectory for apps/web

## 4.0.2

### Patch Changes

- 6c57198: Fix socket auth and deployment flow for production by normalizing origins, enabling cross-subdomain auth cookies, and binding the socket server to the Render-injected port.
- Updated dependencies [6c57198]
  - @semantask/auth@2.3.2

## 4.0.1

### Patch Changes

- 67ff3ac: Publish dedicated chat-socket image with legacy compatibility aliases and add otp stepup-up flow in stepup challenge
- Updated dependencies [67ff3ac]
  - @semantask/auth@2.3.1

## 4.0.0

### Major Changes

- 8a4de46: Added task management across the stack, including shared task models/types, task APIs and socket events, a real-time task panel in the web app, and an outbox-driven worker for task intelligence and execution.

### Patch Changes

- Updated dependencies [8a4de46]
  - @semantask/services@2.0.0
  - @semantask/types@1.3.0

## 3.1.0

### Minor Changes

- 2c48736: Add Google OAuth auth-flow reliability fixes in auth and web, including monorepo env loading support, clearer callback failure handling, and improved login fallback behavior

### Patch Changes

- Updated dependencies [2c48736]
  - @semantask/auth@2.3.0
