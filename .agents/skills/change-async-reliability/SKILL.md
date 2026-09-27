---
name: change-async-reliability
description: >-
  Safely change Semantask outbox processing, leases, retries, dead-letter,
  idempotency keys, or stuck-task detection in the task-worker. Use when editing
  at-least-once delivery or duplicate side-effect prevention. Do not use for
  tool adapters or suggest_only policy semantics alone.
---

# Change Async Reliability

> Canonical repository invariants, package boundaries, and test commands live in
> [`AGENTS.md`](../../../AGENTS.md). This skill adds the task-scoped procedure and
> does not restate them.

## Purpose

Change the worker’s reliability layers (outbox claim/ack/DLQ, execution leases,
retry scheduling/classification, idempotency) so at-least-once delivery does not
create duplicate external side effects, per ADR-002.

## When to use

- Editing outbox claim/complete/fail/defer/dead-letter behavior.
- Changing lease acquisition, heartbeat, or busy deferral.
- Changing retry backoff, `retry_scheduled` promotion, or retry classification.
- Changing tool/action idempotency key composition or guards.

## When not to use

- Policy/mode decisions → `change-execution-policy`.
- New tool → `add-worker-tool`.
- Prompt/decision loop changes without retry/idempotency impact →
  `change-agent-loop`.
- Need a failure map first → `trace-task-execution`.

## Workflow

1. **Inspect first**
   - ADR-002: `docs/decisions/ADR-002-retry-orchestration-strategy.md`.
   - Outbox loop + handlers: `apps/task-worker/index.ts`,
     `packages/services/outbox.service.ts`.
   - Leases: `services/lease.service.ts`, `services/task-lease.ts`.
   - Retries: `retry-manager.ts`, `retry-scheduler.ts`, `retry-classifier.ts`,
     `schedule-retry.ts`.
   - Idempotency: tool key builder / guards in `ToolExecutor` / tests in
     `tests/idempotent-tool-execution.test.ts`.
   - Stuck detection: `stuck-task-detector.ts`.

2. **Gather context**
   - Which layer: outbox vs task-level retry vs inline RetryManager vs tool
     idempotency.
   - Failure mode: duplicate side effect, lost event, poison message, lease
     steal, stuck `processing`.

3. **Trace relationships**
   - Outbox is at-least-once; Redis `dedupeKey` processing guard + tool
     idempotency sit above it.
   - Claim eagerly `$inc attempts`; lease-busy must **defer** (restore attempt),
     not complete.
   - Tool idempotency key composition: AGENTS.md §2.8 (run-independent).
   - `tests/idempotent-tool-execution.test.ts` currently duplicates a simplified
     key helper (`JSON.stringify`); when changing canonicalization, update
     production `stableStringify` and align or replace that test twin.
   - Stale `processing` outbox rows become re-claimable after the lock timeout
     used in outbox.service — confirm the timeout in code, do not hardcode from memory.

4. **Evidence**
   - Tests: `dispatch.lease-wrapper.test.ts`, `lease.contention.test.ts`,
     `idempotent-tool-execution.test.ts`, `retry-*.test.ts`,
     `stuck-task-detector.test.ts`, `packages/services/__tests__/outbox.service.test.ts`.

5. **Reason**
   - Prefer fixing the correct layer; do not paper over duplicates by disabling
     retries.
   - Keep side-effecting adapters behind idempotency keys.
   - Document whether a change alters attempt accounting or DLQ thresholds.

6. **Validate**
   - Add/adjust tests for duplicate suppression and lease-busy defer.
   - Run focused worker + outbox tests.
   - Mentally simulate: crash after side effect but before ack; second worker
     claim; ensure no double external write.

7. **Produce** the change + summary below.

## Repository-specific knowledge

- ADR-002 defines three retry layers: outbox, task-level, inline RetryManager.
- `ExecutionLeaseBusyError` → `markOutboxEventDeferred` (not success).
- Dead-letter after `OUTBOX_MAX_ATTEMPTS` (fallback 12 via `config/worker.ts`).
- Per-event Redis processed-key prefix/format: verify in `apps/task-worker/index.ts`
  at edit time (do not hardcode from memory).
- Unique `TaskAction.idempotencyKey` participates in tool replay protection.

## Rules

- Do not invent a new queue system; extend outbox + existing schedulers.
- Preserve idempotency across lease handoffs (no `runId` in tool keys unless
  product explicitly redesigns and migrates).
- Consider observability: stuck-task logs, execution events, DLQ visibility.
- Be explicit about at-least-once vs exactly-once (this system is not
  exactly-once end-to-end).
- Avoid destructive ops (drop DLQ, wipe idempotency keys) unless user asks.

## Output

```markdown
## Reliability change summary
- **Layer**: outbox | lease | task-retry | inline-retry | tool-idempotency
- **Failure mode addressed**: …
- **Duplicate side-effect analysis**: crash-after-success / re-claim / lease steal
- **Attempt accounting impact**: …
- **Files**: …
- **Tests**: …
- **Residual at-least-once risks**: …
```

## Failure handling

- **Cannot prove duplicate safety**: stop; add a failing test that demonstrates
  the race before changing production code.
- **ADR-002 vs code drift**: prefer code; note doc gaps.
- **Tests cannot run**: do not ship retry/idempotency relaxations.
- **Fix seems to need exactly-once semantics**: redesign with user; do not claim
  exactly-once without durable single-flight across all adapters.

## Examples

- "Worker completes outbox while lease busy" → defer path + dispatch tests.
- "Emails duplicate after pod restart" → tool idempotency key + TaskAction guard.
- "retry_scheduled tasks never return" → retry-scheduler promotion logic + tests.

## Quality checklist

- [ ] Correct ADR-002 layer identified
- [ ] Lease-busy defer behavior preserved or intentionally changed with tests
- [ ] Tool idempotency still runId-independent unless redesign is explicit
- [ ] Duplicate side-effect scenario tested
- [ ] DLQ / attempt semantics documented in the summary
