---
name: add-worker-tool
description: >-
  Add a new Semantask task-worker execution tool end-to-end (types, Tool
  implementation, registry, policy/grants touchpoints, config, tests). Use when
  introducing a new external action the agent can call. Do not use for policy-only
  changes, step-loop refactors, or non-tool worker work.
---

# Add Worker Tool

> Canonical repository invariants, package boundaries, and test commands live in
> [`AGENTS.md`](../../../AGENTS.md). This skill adds the task-scoped procedure and
> does not restate them.

## Purpose

Add one new executable tool that follows the existing `Tool` + `ToolRegistry`
pattern, wires into shared types, and stays behind execution policy, grants,
idempotency, and tests. Do not invent a parallel tool system.

## When to use

- User asks to add a new agent/worker capability that calls an external system.
- Extending beyond current tools: `send_email`, `schedule_meeting`,
  `create_github_issue`.

## When not to use

- Changing when tools may run (modes, thresholds, deny lists) →
  `change-execution-policy`.
- Changing how the loop chooses/executes tools → `change-agent-loop`.
- Debugging why an existing tool did not run → `trace-task-execution` first.
- Suggest-only / coordination UX with no tool adapter → not this skill.

## Workflow

1. **Inspect first**
   - Read one existing tool fully: `services/tools/send-email.tool.ts` (or
     create-issue / schedule-meeting).
   - Read `services/tools/tool-registry.ts` (`Tool`, `ToolResult`, registry APIs).
   - Read registration in `services/agent/context.ts` (`createDefaultToolRegistry`).
   - Read shared catalog: `packages/types/task/tools.ts` and
     `TaskExecutionActionType` in `packages/types/task/task.ts`.

2. **Gather context**
   - Tool name (must become a `TaskExecutionActionType` value), inputs, external
     API, secrets/env, risk (email domains, webhooks, GitHub-like writes).
   - Whether org policy, prompt-guard, or grant RBAC must treat it specially.

3. **Trace dependencies**
   - Types → tool class → registry registration → `ToolExecutor` path
     (grants, prompt guard, idempotency, `TaskAction`) →
     `execution-policy.ts` action-specific checks if needed → config in
     `apps/task-worker/config/tools.ts` → tests.

4. **Evidence / patterns to reuse**
   - Zod `inputSchema` on the tool class; `execute` returns
     `{ summary, adapterSuccess, evidence, error? }`.
   - Pass `AbortSignal` and optional `Idempotency-Key` from
     `context.metadata.idempotencyKey` when the upstream API supports it.
   - Config getters live under `apps/task-worker/config/tools.ts` (see Resend /
     webhook helpers).
   - Do not bypass `assertToolGrant` / execution-mode checks inside the tool;
     those belong in `ToolExecutor` / policy.
   - Grep for an existing tool name (e.g. `send_email`) and update **every**
     union/catalog hit, including `RequestedToolName` in `agent/types.ts` and
     any step-loop requested-tool helpers.

5. **Reason about the change**
   - Prefer extending the existing union + `EXECUTION_TOOLS` list over a second
     naming scheme.
   - Keep adapter logic in `services/tools/*.tool.ts`; keep policy rules in
     `execution-policy.ts`; keep loop logic out of the tool.
   - Plan tests that do not require live network (mock fetch / inject config).

6. **Validate**
   - Grep for the old tool name pattern to find all touchpoints
     (`send_email` is a good probe).
   - Run focused tests:
     `pnpm --filter @semantask/task-worker test` (or the specific new test file).
   - Confirm `suggest_only` still blocks execution unless bypass flags apply
     (do not weaken mode gates to "make the tool work" in tests without
     documenting `tests/test-env.ts` defaults).

7. **Produce** implementation + the structured summary below.

## Repository-specific knowledge

- Tools implement `Tool` and register on `ToolRegistry` in
  `AgentContext.createDefaultToolRegistry`.
- Shared tool names are catalogued in `packages/types/task/tools.ts`
  (`EXECUTION_TOOLS` / `EXECUTION_TOOL_NAMES`).
- `ToolExecutor` enforces grants (`assertToolGrant`), org execution mode,
  prompt-guard for email/meeting today, and idempotent `TaskAction` writes.
- Policy has per-action parameter checks for `send_email`,
  `schedule_meeting`, and `create_github_issue` in `execution-policy.ts`.
- Worker package test script:
  `INTERNAL_SECRET=… TASK_TOOL_RBAC=off tsx --test tests/**/*.test.ts`.

## Rules

- Reuse `Tool` / `ToolRegistry`; do not create a new plugin framework.
- Do not invent APIs or env vars without adding them to `env.sample` when they
  are required for operators.
- Do not weaken gates to demo a tool (AGENTS.md §2.1, §6 test-env note).
- Preserve idempotency: stable params must not double-send across lease handoffs.
- Prefer pure unit tests; avoid live Resend/GitHub/webhook calls.
- Keep socket persistence boundaries: tools must not import socket mongoose models.

## Output

```markdown
## Tool change summary
- **Name**: …
- **External system**: …
- **Files touched**: …
- **Types updated**: TaskExecutionActionType / EXECUTION_TOOLS: yes|no
- **Policy / grant / prompt-guard impact**: …
- **Config / secrets**: …
- **Idempotency**: how keys reach the adapter
- **Tests added/updated**: …
- **Manual verification**: …
```

## Failure handling

- **Missing external API contract**: stop; ask for endpoints/auth/idempotency behavior.
- **Unclear whether feature is suggest-only coordination vs tool**: clarify; do not add a tool for suggestion-only UX.
- **Grep finds unexpected coupling**: expand the touch list; do not leave stale unions.
- **Tests cannot run**: still implement + document the exact test command; mark unverified.
- **Would require weakening suggest_only to demo**: refuse; use approval / auto_execute test setup instead.

## Examples

- "Add a Slack notify tool" → new tool class + types + registry + policy inputs + tests.
- "Support creating Linear issues" → same pattern as `CreateIssueTool`.

## Quality checklist

- [ ] Mirrors an existing tool’s shape
- [ ] Types catalog + `RequestedToolName` (and grep leftovers) updated
- [ ] Registered in `createDefaultToolRegistry`
- [ ] Policy/grant implications considered
- [ ] No live network in unit tests
- [ ] suggest_only gates untouched except intentional policy work
