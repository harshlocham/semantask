# @semantask/socket

## 4.2.0

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

## 4.1.0

### Minor Changes

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

- Updated dependencies [6343a6f]
- Updated dependencies [1308ef0]
- Updated dependencies [4a0b104]
- Updated dependencies [8049e1b]
  - @semantask/types@2.1.0
  - @semantask/observability@1.1.0

## 4.0.0

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

## 3.0.4

### Patch Changes

- 51f6a45: Hardened realtime authorization and internal communication architecture across the platform. Refactored the socket server into a transport-only layer using secure internal web authorization bridges, centralized conversation/task ACL enforcement, server-resolved participant fan-out, and mandatory INTERNAL_SECRET validation. Added shared authorization services for REST and socket flows, removed client-trusted recipient authorization paths, restricted unsafe task status mutations, and improved overall security consistency for realtime messaging and task execution.

## 3.0.3

### Patch Changes

- 5a2cba8: - Socket: register message:send handlers; broadcast online status on connect; remove duplicate join/leave handlers
  - Web: connect socket after login/register without reload; stop disconnecting on tab visibility changes
  - Mobile: reconnect on app foreground instead of disconnecting in background
  - Task worker: use @semantask/services package imports so production start resolves modules correctly
  - Root: Next 15.5.18 override, uuid 14, ESLint config baseDirectory for apps/web

## 3.0.2

### Patch Changes

- 6c57198: Fix socket auth and deployment flow for production by normalizing origins, enabling cross-subdomain auth cookies, and binding the socket server to the Render-injected port.

## 3.0.1

### Patch Changes

- 5fb4167: fix socket production connection issue

## 3.0.0

### Major Changes

- 8a4de46: Added task management across the stack, including shared task models/types, task APIs and socket events, a real-time task panel in the web app, and an outbox-driven worker for task intelligence and execution.

### Patch Changes

- Updated dependencies [8a4de46]
  - @semantask/types@1.3.0
