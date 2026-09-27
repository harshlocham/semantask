---
name: change-execution-policy
description: >-
  Safely change Semantask execution policy, execution modes (suggest_only /
  require_approval / auto_execute), confidence thresholds, org overlays,
  prompt-guard, or suggest_only ingress gates. Use when editing when tools may
  run. Do not use for adding tools or rewriting the agent loop.
---

# Change Execution Policy

> Canonical repository invariants, package boundaries, and test commands live in
> [`AGENTS.md`](../../../AGENTS.md). This skill adds the task-scoped procedure and
> does not restate them.

## Purpose

Modify **when** autonomous tool execution is allowed, blocked, or sent to
approval — without breaking ADR-005 suggest-first invariants or leaking tool
side effects under `suggest_only`.

## When to use

- Changing confidence thresholds, email-domain rules, tool deny lists, or
  `requireApprovalFor`.
- Changing execution mode resolution or enforce behavior.
- Editing `suggest-only-execution-gate.ts` or ingress fail-closed paths in
  `apps/task-worker/index.ts`.
- Org policy overlay behavior for execution (`OrganizationPolicy` fields used by
  the worker).

## When not to use

- Adding a new tool adapter → `add-worker-tool`.
- Changing StepLoop / planner / memory → `change-agent-loop`.
- Pure debugging of a single stuck task → `trace-task-execution` first.
- Coordination/suggestion UX without execution-mode semantics → normal feature work.

## Workflow

1. **Inspect first**
   - `apps/task-worker/services/execution-policy.ts`
     (`evaluateExecutionPolicy`, `applyExecutionModeGate`).
   - `apps/task-worker/services/suggest-only-execution-gate.ts`.
   - Effective mode helpers:
     `getEffectiveExecutionMode` / `isExecutionModeEnforce` (services package).
   - ADR-005: `docs/decisions/ADR-005-suggest-first-work-coordination.md`.
   - Pinning tests: `tests/execution-policy.test.ts`,
     `tests/suggest-only-execution-gate.test.ts`,
     `packages/services/__tests__/organization-policy.execution-mode.test.ts`,
     `packages/services/__tests__/task-intelligence.suggest-only.test.ts`.

2. **Gather context**
   - Desired mode behavior per personal vs org overlay.
   - Prompt-guard modes (separate from execution-mode enforce): off / monitor /
     enforce.
   - Bypass flags: `explicitManagerRequest`, `humanApprovedExecution` — only
     those skip suggest_only ingress fail-closed.

3. **Trace relationships**
   - Policy decision outcomes: `auto_execute` | `approval_required` | `blocked`.
   - Mode gate: `suggest_only` → blocked with reason `execution_mode:suggest_only`
     when enforce is on; `require_approval` downgrades `auto_execute`.
   - Worker ingress may separately fail-closed for leaked suggest_only enqueues.
   - `ToolExecutor` also respects effective execution mode at tool time — policy
     and executor must stay consistent.

4. **Evidence**
   - Existing reason strings and test assertions (do not rename casually).
   - Org overlay fields actually read today: `confidenceThresholds`,
     `allowedEmailDomains`, `requireApprovalFor`, `toolDenyList`,
     `promptGuardMode`, `executionMode`.

5. **Reason**
   - Prefer pure functions + unit tests (as `suggest-only-execution-gate.ts` does).
   - Never “fix” flaky autonomy by defaulting production to `auto_execute`.
   - Treat false tool side effects under effective `suggest_only` as **P0**.

6. **Validate**
   - Update/add tests that would fail if suggest_only allowed tools.
   - Run:
     - `pnpm --filter @semantask/task-worker exec tsx --test tests/execution-policy.test.ts tests/suggest-only-execution-gate.test.ts`
     - relevant `packages/services` policy/suggest-only tests when overlays change.
   - Confirm `tests/test-env.ts` still documents why tests use `auto_execute`.

7. **Produce** the change + summary below.

## Repository-specific knowledge

Policy-scoped facts (mode/enforce/bypass rules: AGENTS.md §2.1–2.3):

- ADR-005 text mentions allowlisted `auto_execute` intents/tools as product
  intent — verify what the code actually allowlists before assuming one exists.
- Per-intent thresholds live in `execution-confidence.ts`; org overlays may
  override them.
- Prompt-guard currently specializes email/meeting recipient checks inside
  policy (`send_email`, `schedule_meeting` only).
- Reason strings (e.g. `execution_mode:suggest_only`) are asserted by tests —
  renaming them is a breaking change.

## Rules

- Do not invent new execution modes without types + ADR update discussion.
- Do not broaden suggest_only bypasses beyond explicit manager / human-approved
  paths without explicit product approval.
- Keep policy functions pure where they already are; put I/O elsewhere.
- Preserve authorization and audit: blocked/approval paths should still leave
  explainable `reasons`.
- Distinguish product default (`suggest_only`) from test harness defaults.
- Do not reintroduce a global enforce toggle; production enforce is hardcoded on.

## Output

```markdown
## Policy change summary
- **Intent**: …
- **Modes / thresholds / overlays touched**: …
- **P0 suggest_only impact**: unchanged | tightened | relaxed (justify)
- **Bypass flags affected**: …
- **Files**: …
- **Tests**: …
- **Residual risk**: …
```

## Failure handling

- **Product intent unclear** (suggest vs auto): stop and ask; default to fail-closed.
- **Docs disagree with code**: implement to code + ADR-005; note doc drift.
- **Cannot run tests**: do not merge policy relaxation; ship only with failing-risk called out.
- **Change would allow tools under suggest_only**: refuse unless user explicitly redesigns ADR-005 and updates gates + tests together.

## Examples

- "Raise incident auto-execute threshold to 0.8" → confidence map + policy tests.
- "Org deny list blocks send_email" → overlay + evaluateExecutionPolicy tests.
- "Leaked execution events under suggest_only still call tools" → ingress gate + P0 tests.

## Quality checklist

- [ ] ADR-005 invariant preserved or explicitly redesigned
- [ ] Reasons remain assertable in tests
- [ ] Bypass paths remain narrow
- [ ] ToolExecutor/mode consistency considered
- [ ] Focused policy tests updated and run
