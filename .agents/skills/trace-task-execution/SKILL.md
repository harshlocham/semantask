---
name: trace-task-execution
description: >-
  Trace a Semantask task or execution bug through outbox claim, policy gates,
  AgentRunner/StepLoop, tools, leases, and socket bridge. Use when debugging
  why a task did not run, ran unexpectedly, stalled, retried, or skipped tools.
  Do not use for UI-only bugs, greenfield features, or as a substitute for the
  change-* skills when the edit target is already known.
---

# Trace Task Execution

> Canonical repository invariants, package boundaries, and test commands live in
> [`AGENTS.md`](../../../AGENTS.md). This skill adds the task-scoped procedure and
> does not restate them.

## Purpose

Produce an evidence-based map of how a concrete task (or a hypothesized failure)
moves through `apps/task-worker`: outbox → topic handler → execution policy /
suggest_only gate → lease → AgentRunner → StepLoop → ToolExecutor → tools →
persistence / socket fan-out. Distinguish **observed** code paths from
assumptions.

## When to use

- A task never executes, executes under `suggest_only`, or tools fire when they should not.
- Approval, retry, lease-busy, idempotency skip, or dead-letter behavior is unclear.
- Logs mention `execution_mode:suggest_only`, lease busy, `LLM_ERROR`, or tool grant denial.
- You must map the live control-flow for a **specific** stuck/wrong execution before editing.

## When not to use

- Pure web/UI, auth, or messaging bugs with no task-worker involvement → normal debugging.
- Adding a new tool end-to-end → `add-worker-tool`.
- Changing policy thresholds or modes → `change-execution-policy`.
- Changing planner/step-loop internals → `change-agent-loop`.
- Changing outbox/retry/idempotency mechanics as the primary goal → `change-async-reliability`.

## Workflow

1. **Inspect first**
   - Start at `apps/task-worker/index.ts` topic routing (`message.created`,
     `task.execution.requested`, `task.execution.approved`, `task.created` /
     `task.updated`).
   - Skim `docs/archive/optional-autonomy/task-worker-execution-flow.md` and
     ADR-002 / ADR-005 only for orientation; prefer code over docs if they disagree.

2. **Gather context**
   - Identify: topic, `taskId`, `actionType`, `semanticType`, confidence,
     `organizationId` / org policy, effective `executionMode`, and whether
     `explicitManagerRequest` / `humanApprovedExecution` flags apply.
   - Note env that affects gates: `DEFAULT_EXECUTION_MODE`, classifier mode,
     tool RBAC (`TASK_TOOL_RBAC`), LLM provider config.

3. **Trace relationships**
   - `message.created` → `packages/services/task-intelligence.service.ts`
     (`classifyMessage`) → may enqueue `task.execution.requested`.
   - `task.execution.requested` → `evaluateExecutionPolicy` +
     `suggest-only-execution-gate.ts` helpers → approval / blocked / lease + run.
   - Run path: `WorkflowRegistry` → `DefaultAgentLoopTemplate` →
     `AgentRunner.runTask` (facade) → `StepLoop.runTask` → `ToolExecutor` →
     `ToolRegistry` tools.
   - If `TASK_AGENT_PERSISTENT_LOOP_ENABLED=true`, StepLoop delegates to
     `runTaskPersistent` (private). Do not assume a public
     `AgentRunner.runTaskPersistent` API — that name appears in older docs only.
   - Side channels: `TaskAction` idempotency, Redis processed-event keys,
     internal socket `/internal/*` emits.

4. **Evidence to look for**
   - Policy `reasons` (especially `execution_mode:suggest_only`).
   - Lease defer (`ExecutionLeaseBusyError` → outbox deferred, not completed).
   - Tool idempotency: `ToolExecutor.buildToolIdempotencyKey` SHA-256 over
     `taskId|stepId|toolName|stableStringify(params)` (no `runId`).
   - Tests that pin the behavior: `tests/execution-policy.test.ts`,
     `tests/suggest-only-execution-gate.test.ts`,
     `tests/idempotent-tool-execution.test.ts`,
     `tests/dispatch.lease-wrapper.test.ts`.

5. **Reason**
   - Classify the failure layer: ingress classification, policy/mode gate,
     approval pending, lease contention, agent decision, tool grant, adapter,
     verification, retry/DLQ, or bridge emit.
   - Call out P0 if tools run under effective `suggest_only` without the
     explicit manager / human-approved bypass path.

6. **Validate**
   - Cite file + symbol for each hop on the critical path.
   - Mark any hop you did not open as **unverified**.
   - Prefer running the smallest relevant worker test file when the claim is
     behavioral.

7. **Produce** the structured output below. Stop. Do not implement fixes unless
   the user also asked for a fix (then hand off to the appropriate change skill).

## Repository-specific knowledge

Trace-scoped facts (invariants: AGENTS.md §2):

- Three suggest_only layers can each end a trace: enqueue refusal (services),
  worker ingress fail-closed (`index.ts`), tool-time denial (`ToolExecutor`).
  Identify **which** one fired before concluding.
- `WorkflowRegistry` currently resolves to `DefaultAgentLoopTemplate` for all
  semantic types (specialized templates are extension points only).
- Registered tools today: `send_email`, `schedule_meeting`, `create_github_issue`
  (`AgentContext.createDefaultToolRegistry`).
- Ingress classification defaults to regex/heuristic (`TASK_CLASSIFIER_MODE`),
  so a missing task is often a classifier miss, not a policy block.

## Rules

- Inspect code before trusting architecture docs; docs may lag.
- Do not invent topics, tools, or flags not present in code/types.
- Distinguish observed behavior vs assumption in the output.
- Preserve architectural boundaries in recommendations: socket is transport-only;
  persistence stays in web/services/db; worker consumes outbox.
- Treat security gates (execution mode, tool grants, prompt guard, email domains)
  as load-bearing, not optional.

## Output

```markdown
## Execution trace
- **Symptom**: …
- **Layer**: ingress | policy | approval | lease | agent | tool | retry | bridge
- **Critical path** (ordered, with file#symbol):
  1. …
- **Effective gates**: executionMode=…; outcome=…; reasons=…
- **Idempotency / lease notes**: …
- **Evidence**: tests/logs/code cites
- **Unverified**: …
- **Safe next step**: one concrete action (or "needs more evidence")
```

## Failure handling

- **Missing taskId / logs**: ask for topic + identifiers; produce a generic path map labeled hypothetical.
- **Ambiguous docs vs code**: prefer code; note the conflict.
- **Tests cannot run**: still deliver the trace from static analysis; mark validation incomplete.
- **Assumption conflicts with code**: discard the assumption; re-trace from the conflicting file.
- **Cannot safely conclude**: stop at the last verified hop; do not invent a root cause.

## Examples

- "Task stays blocked and never calls Resend" → trace policy + suggest_only + grants.
- "Duplicate emails after worker restart" → trace tool idempotency key + TaskAction.
- "Outbox event disappears while another worker holds the lease" → trace lease-busy defer.

## Quality checklist

- [ ] Every hop cites a real file/symbol
- [ ] Layer named and justified
- [ ] suggest_only / P0 called out when relevant
- [ ] Unverified items listed explicitly
- [ ] No implementation unless requested
