# @semantask/task-worker

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
