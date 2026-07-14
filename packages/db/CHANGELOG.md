# @semantask/db

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

## 3.0.0

### Major Changes

- fe46888: Rebrand from chat-app / @chat to Semantask / @semantask.
  - Product name: AgentMesh AI → Semantask
  - npm scope: @chat/_ → @semantask/_
  - Default MongoDB database: chat-app → semantask
  - VPS deploy path example: /opt/chat-app → /opt/semantask

  Breaking for anyone still importing @chat/\* or using the old DB/deploy paths.
  Existing Mongo data in `chat-app` is unchanged; update MONGODB_URI or migrate data.

## 2.0.3

### Patch Changes

- 51f6a45: Hardened realtime authorization and internal communication architecture across the platform. Refactored the socket server into a transport-only layer using secure internal web authorization bridges, centralized conversation/task ACL enforcement, server-resolved participant fan-out, and mandatory INTERNAL_SECRET validation. Added shared authorization services for REST and socket flows, removed client-trusted recipient authorization paths, restricted unsafe task status mutations, and improved overall security consistency for realtime messaging and task execution.

## 2.0.2

### Patch Changes

- e3ad385: The system has been fully implemented to support multi-step execution with strict safety and hallucination prevention.d it can self-heal a failed tool execution by asking the LLM for a corrected decision before falling back to normal retry behavior. The planner now preserves step input/output from LLM plans and explicitly asks for template-ready step context

## 2.0.1

### Patch Changes

- 67ff3ac: Publish dedicated chat-socket image with legacy compatibility aliases and add otp stepup-up flow in stepup challenge

## 2.0.0

### Major Changes

- 8a4de46: Added task management across the stack, including shared task models/types, task APIs and socket events, a real-time task panel in the web app, and an outbox-driven worker for task intelligence and execution.

## 1.2.0

### Minor Changes

- 3215a80: Enhanced mobile authentication and chat session management, and standardized monorepo build tooling across shared packages.
  - Added mobile auth support improvements and session flow hardening.
  - Added explicit build scripts/config for shared packages (auth, db, services, redis, types) to emit dist artifacts consistently.
  - Improved repository cleanup scripts with safer artifact cleanup and full-reset options.
  - Updated Turbo build outputs for better Next.js build caching behavior.

## 1.1.3

### Patch Changes

- 86f8cfe: Refactor CI/CD to use Changesets-native package tags for deployment
  - Removed root `v*` tag creation logic from release workflow
  - Updated deploy workflow to trigger on Changesets tags (`@semantask/services@*`)
  - Implemented strict tag parsing and validation
  - Added package-specific deployment gating
  - Improved Docker tagging and metadata extraction
  - Enforced PAT usage for reliable workflow chaining

## 1.1.2

### Patch Changes

- 86f8cfe: Fix release workflow to create root version tags for deploy trigger
  - **release.yml**: Add step to create root repository version tag (v\*) based on highest package version
  - **deploy.yml compatibility**: Root v\* tags now enable proper deployment workflow triggering
  - This resolves the issue where release workflow created only package-scoped tags but deploy workflow needed root tags

## 1.1.1

### Patch Changes

- 3b307d2: Fix CI/CD release and deployment pipeline configuration
  - **release.yml**: Fix publish step to actually create git tags using `npx changeset tag` instead of echo fallback
  - **release.yml**: Add robust token fallback (`CHANGESETS_GITHUB_TOKEN || GITHUB_TOKEN`) for private repo releases
  - **deploy.yml**: Relax actor gate to allow repository owner to trigger deployments from token-based releases
  - **deploy.yml**: Add comprehensive deployment provenance validation (semver format, commit ancestry, GitHub Release verification)
  - **deploy.yml**: Add timeout configurations and improve error handling for staging/production builds

  These fixes ensure the automated release pipeline correctly creates version tags and the deployment workflow is properly triggered, enabling end-to-end CI/CD automation for the monorepo.

## 1.1.0

### Minor Changes

- c5b8b6c: Migrate authentication to JWT with stronger session controls and security hardening.
  - Replace legacy auth flow with access/refresh JWT tokens and server-backed session validation.
  - Add tokenVersion-based global session invalidation for emergency token revocation.
  - Harden login, refresh, logout, and logout-all flows with stricter validation and invalidation behavior.
  - Update user schema for mixed provider accounts, including OAuth-only users with optional password.
  - Apply OAuth/provider-linking and auth-route security hardening to close identified edge cases.
