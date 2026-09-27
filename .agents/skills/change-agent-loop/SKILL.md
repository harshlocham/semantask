---
name: change-agent-loop
description: >-
  Safely change Semantask planner, StepLoop, memory, tool-ranking, workflow
  templates, or AgentRunner collaborators without breaking the facade split or
  execution gates. Use when editing how the agent plans, decides, or iterates.
  Do not use for adding tools or policy-only edits.
---

# Change Agent Loop

> Canonical repository invariants, package boundaries, and test commands live in
> [`AGENTS.md`](../../../AGENTS.md). This skill adds the task-scoped procedure and
> does not restate them.

## Purpose

Modify the optional autonomous agent control loop (plan → rank tools → decide →
execute → verify → reflect/memory) while preserving the existing module
boundaries and suggest-first safety gates.

## When to use

- Changing `planner.ts`, `agent/step-loop.ts`, `memory-service.ts`,
  `reflection-service.ts`, `tool-ranking.ts`, or `services/workflow/*`.
- Adjusting decision prompts, step dependencies/fallback policy handling,
  clarification resume, or persistent vs autonomous loop behavior.
- Adding a specialized `WorkflowTemplate` behind `WorkflowRegistry`.

## When not to use

- New external adapter only → `add-worker-tool`.
- Mode/threshold/deny-list only → `change-execution-policy`.
- Outbox/lease/retry key mechanics → `change-async-reliability`.
- Need to understand a failure first → `trace-task-execution`.

## Workflow

1. **Inspect first**
   - Facade: `services/agent-runner.ts` (must stay a thin composer).
   - Collaborators: `agent/context.ts`, `agent/step-loop.ts`,
     `agent/tool-executor.ts`, `agent/clarification-handler.ts`,
     `agent/shadow-fsm-writer.ts`, `agent/types.ts`.
   - Planning/memory: `planner.ts`, `memory-service.ts`,
     `reflection-service.ts`, `tool-ranking.ts`.
   - Workflow: `workflow-registry.ts`, `default-agent-loop.template.ts`,
     registration in `apps/task-worker/index.ts`.

2. **Gather context**
   - Which loop path is in play: default autonomous iterations inside
     `StepLoop.runTask`, or opt-in persistent plan steps when
     `TASK_AGENT_PERSISTENT_LOOP_ENABLED=true` (`runTaskPersistent`).
   - Whether change touches LLM prompts, persistence (`TaskPlan`, `TaskMemory`,
     `TaskReflection`), or pure scoring (`rankTools`).

3. **Trace relationships**
   - `AgentRunner` constructs collaborators once; StepLoop owns iteration.
   - Tool side effects must continue to go through `ToolExecutor` (grants,
     mode, idempotency, prompt-guard) — never call `ToolRegistry` execute
     ad hoc from new code paths.
   - Memory: short_term is task-scoped with TTL; long_term is broader
     (`memory-service.ts`). Reflection writes memory after runs.
   - WorkflowRegistry: first matching `supports(semanticType)`, else default
     template.

4. **Evidence**
   - Tests: `agent-runner.persistent-loop.test.ts`,
     `agent-runner.autonomy.test.ts`, `agent-runner.cancellation.test.ts`,
     `workflow-registry.test.ts`, module-shape tests.
   - Ranking formula is pure and tiny — prefer extending inputs over
     rewriting call sites blindly.

5. **Reason**
   - Prefer small pure helpers (like `tool-ranking.ts`, workflow templates)
     over growing `step-loop.ts` further when possible.
   - Do not re-monolith `AgentRunner`; keep public surface
     `runTask` / `resumeTask`.
   - Deterministic planner fallback must remain if LLM plan generation fails
     (`buildFallbackPlan` in `planner.ts`).

6. **Validate**
   - Run the smallest agent-runner / workflow tests affected.
   - Confirm cancellation and lease watchdog paths still abort before side
     effects where existing guards exist.
   - Confirm no new path executes tools under `suggest_only`.

7. **Produce** the change + summary below.

## Repository-specific knowledge

- `step-loop.ts` owns both loop styles (facade/opt-in rules: AGENTS.md §2.5–2.6).
- Default workflow simply delegates to `agentRunner.runTask`.
- `rankTools` score =
  `0.55*capability + 0.35*history - 0.07*risk - 0.03*recentFailure` (clamped).
- Planner persists `TaskPlan` / steps with dependency + `fallbackPolicy` fields.
- Shadow FSM writers exist alongside legacy task fields (ADR-001); do not remove
  shadow writes casually.

## Rules

- Inspect existing collaborators before adding new orchestration layers.
- Reuse ToolExecutor for any tool invocation.
- Do not invent a second workflow engine; extend `WorkflowTemplate` /
  `WorkflowRegistry`.
- Preserve clarification resume via `resumeTask`.
- Consider observability: execution events / logging helpers already used by the
  loop.
- Keep changes test-backed; agent loops are behavior-sensitive.

## Output

```markdown
## Agent loop change summary
- **Loop path affected**: autonomous | persistent | both | workflow only
- **Collaborators touched**: …
- **Still goes through ToolExecutor**: yes|no (must be yes for tools)
- **Plan/memory/ranking impact**: …
- **Flags/config**: …
- **Tests**: …
- **Non-goals / will not touch**: …
```

## Failure handling

- **Unclear which loop path is live**: read `persistentLoopEnabled` /
  `TASK_AGENT_PERSISTENT_LOOP_ENABLED` before changing only one path. Default
  is autonomous (flag false) unless env enables persistent.
- **Step-loop too large to edit safely**: extract a pure helper with tests;
  avoid drive-by reformat of the whole file.
- **LLM behavior ambiguous**: add deterministic fallback/tests; do not rely on
  live model output for CI.
- **Tests cannot run**: mark unverified; do not claim loop safety.
- **Change conflicts with policy gates**: stop; coordinate with
  `change-execution-policy`.

## Examples

- "Specialize workflow for incident semantic type" → new WorkflowTemplate +
  registry.register + tests.
- "Bias tool ranking against recent failures more" → `tool-ranking.ts` + unit
  assertions.
- "Persist richer short-term tool feedback" → `memory-service` / reflection
  call sites only.

## Quality checklist

- [ ] AgentRunner facade still thin
- [ ] Tools only via ToolExecutor
- [ ] WorkflowRegistry extension pattern reused if applicable
- [ ] Deterministic fallback considered for planner/LLM
- [ ] Focused agent tests updated/run
