# AGENTS.md — Semantask

Instructions for any AI coding agent working in this repository. Portable and
tool-agnostic. This file is the canonical source for repository invariants and
conventions. Worker procedures live in `.agents/skills/`; the router below names
which file to open.

## 1. What this repository is

Semantask is an **AI-native work coordination platform**: teams chat, AI extracts
work as reviewable suggestions, managers approve and coordinate. Autonomous tool
execution is an **optional, policy-gated capability — not the product promise**
([ADR-005](docs/decisions/ADR-005-suggest-first-work-coordination.md)).

pnpm + Turborepo monorepo, ESM TypeScript, Node 24 (`.nvmrc`; CI matrix 24.x).

| Workspace | Role |
|---|---|
| `apps/web` | Next.js 15 UI + all HTTP APIs; owns persistence for request paths |
| `apps/socket` | Socket.IO transport only |
| `apps/task-worker` | Outbox consumer; classification + optional agent execution |
| `apps/mobile` | Expo client |
| `packages/types` | Pure shared contracts (zero internal deps) |
| `packages/db` | Mongoose models |
| `packages/services` | Domain logic, repositories, policy helpers |
| `packages/auth`, `packages/observability` | Auth, logs/metrics/tracing |

There is no shared Redis package: the worker and socket each own an `ioredis`
client on `REDIS_URL`. Web uses Upstash REST for rate limiting and its user-state
cache, plus a `redis` client in the admin dashboard route.

Open the matching skill before editing that layer.

| If you are changing | Load |
|---|---|
| Modes, thresholds, prompt-guard, enqueue refusal | `change-execution-policy` |
| Planner, StepLoop, ranking, workflows | `change-agent-loop` |
| Outbox, leases, retries, idempotency, cancel | `change-async-reliability` |
| A new tool adapter | `add-worker-tool` |
| Why a task did or did not run | `trace-task-execution` first |
| Suggestions, notifications, web UI, auth, orgs, socket handlers | this file only (§3) |

### Runtime flow

1. **Message.** `POST /api/messages` calls `createMessage`
   (`packages/services/message.service.ts`), which writes the message and a
   `message.created` `OutboxEvent` in one Mongo transaction.
2. **Classification.** The worker loop (`apps/task-worker/index.ts`) claims outbox
   events and dispatches by topic. `message.created` runs
   `processMessageTaskIntelligence`, which classifies the message and creates a
   `WorkSuggestion`. Under `suggest_only` it stops there. Other modes continue on
   the legacy path: create a task and enqueue `task.execution.requested`.
3. **Review.** `acceptWorkSuggestion` creates a coordination task and never
   enqueues execution. A manager asks for tools through `requestTaskExecution`.
4. **Execution.** `task.execution.requested` / `.approved` pass the suggest_only
   gate, then `evaluateExecutionPolicy`, then `withExecutionLease`, then
   `AgentRunner` → `StepLoop` → `ToolExecutor` → `*.tool.ts`.
5. **Realtime.** Web and the worker push events to the socket server over
   `/internal/*`. The socket server asks web to authorize through
   `/api/internal/socket/*` and never reads Mongo itself.

### Local development

```bash
pnpm install
cp .env.sample .env      # root .env; web, socket, and worker each load it
pnpm run dev             # web :3000, socket :3001, worker (mobile: pnpm mobile)
pnpm run task-worker     # worker alone
```

MongoDB and Redis are external. `docker compose up --build` runs web, socket,
worker, Redis, and nginx, but still needs a reachable `MONGODB_URI`.

## 2. Non-negotiable invariants

Breaking any of these is a product or correctness bug, not a style preference.

1. **`suggest_only` fails closed.** Default execution mode is `suggest_only`.
   False tool side effects under effective `suggest_only` are a **P0**
   (ADR-005). Three independent layers enforce this and all must stay intact:
   - **Write side**: `enqueueTaskExecutionRequested`
     (`packages/services/task-execution-enqueue.service.ts`) refuses to enqueue.
   - **Worker ingress**: `processTaskExecutionRequested`
     (`apps/task-worker/index.ts`) fail-closes on leaked events.
   - **Tool time**: `ToolExecutor` denies with `EXECUTION_MODE_DENIED`.
2. **Only two flags may bypass the suggest_only ingress guard**:
   `explicitManagerRequest` and `humanApprovedExecution`
   (`apps/task-worker/services/suggest-only-execution-gate.ts`).
   `needsApproval` alone must **never** bypass it. Accepting a suggestion must
   never enqueue execution (`isAcceptCreatesExecutionEnabled()` returns `false`).
3. **Execution policy runs before side effects.** `evaluateExecutionPolicy`
   (`apps/task-worker/services/execution-policy.ts`) returns
   `auto_execute | approval_required | blocked` with explainable `reasons`.
   Under enforce + `suggest_only` it short-circuits to `blocked` before any
   other check. `isExecutionModeEnforce()` always returns `true` in production;
   only tests pass `executionModeEnforce: false` into the pure function.
4. **`ToolExecutor` is the side-effect boundary.** `apps/task-worker/services/agent/tool-executor.ts`
   is the only caller of `tool.execute(...)`, and external HTTP lives only in
   `apps/task-worker/services/tools/*.tool.ts`. It owns grants (`assertToolGrant`), execution-mode
   denial, prompt-guard, idempotency, `TaskAction` audit rows, and spans.
   Never invoke a tool adapter from the step loop, a handler, or a script.
5. **`AgentRunner` is a facade.** Public surface is `runTask` / `resumeTask`
   only; it composes `AgentContext`, `ToolExecutor`, `ShadowFsmWriter`,
   `ClarificationHandler`, `StepLoop`. Do not re-monolith it.
6. **Persistent execution is opt-in.** The plan-step loop runs only when
   `TASK_AGENT_PERSISTENT_LOOP_ENABLED === "true"`; otherwise `StepLoop.runTask`
   runs the autonomous iteration path. `runTaskPersistent` is private to
   `StepLoop` — there is no public `AgentRunner.runTaskPersistent`.
7. **Outbox delivery is at-least-once, never exactly-once.** Claims eagerly
   `$inc attempts`; lease contention must `markOutboxEventDeferred` (restoring
   the attempt), **not** complete; dead-letter at `OUTBOX_MAX_ATTEMPTS`
   (fallback 12). See [ADR-002](docs/decisions/ADR-002-retry-orchestration-strategy.md).
8. **Tool side effects require idempotency.** Keys are
   `sha256(taskId|stepId|toolName|stableStringify(params))` — deliberately
   **without `runId`**, so a lease handoff cannot re-fire a side effect. Unique
   `TaskAction.idempotencyKey` backs the guard. Do not add run/attempt identity
   to the key without an explicit migration decision.
9. **Leases and retries preserve duplicate-safety.** `withExecutionLease` is the
   mutex; `ExecutionLeaseBusyError` means "try later", never "done".
10. **Socket stays transport-oriented.** `apps/socket` must not import Mongoose
    models or open a MongoDB connection; it authorizes via
    `POST /api/internal/socket/*` and fans out. `/internal/*` calls are
    authenticated with the shared internal secret
    ([ADR-003](docs/decisions/ADR-003-socket-authorization-bridge.md)).
11. **Shared contracts live in `@semantask/types`** and stay dependency-free and
    side-effect-free (tool catalog: `packages/types/task/tools.ts`).
12. **Domain logic belongs in `@semantask/services`.** See the honest caveat in
    §6 before "fixing" existing violations.

## 3. Coordination

Chat is classified into reviewable work suggestions. Accepting a suggestion
creates a coordination task. Tool execution is a later request, gated by §2.

| Rule | Where | Pinning test |
|---|---|---|
| Accept never enqueues `task.execution.*`. It creates a coordination task and may call `proposeExecutionFromSuggestion`. `acceptWorkSuggestion` calls `assertAcceptCreatesCoordinationOnly`. | `packages/services/work-suggestion.service.ts`, `packages/services/execution-proposal.service.ts`, `packages/services/config/flags.ts` | `packages/services/__tests__/work-suggestion.mutations.test.ts` |
| `isAcceptCreatesExecutionEnabled()` returns `false`. | `packages/services/config/flags.ts` | `packages/services/__tests__/config.flags.test.ts` |
| A manager request that may enqueue goes through `requestTaskExecution`. | `packages/services/task-execution-request.service.ts` | `apps/web/test/task-request-execution.route.test.ts` |
| `notifyUser` claims a `NotifyDedupe` key before send and releases it when delivery does not succeed. | `packages/services/notify.service.ts` | `packages/services/__tests__/notify.service.test.ts` |
| Suggestion access, approval decisions, and coordination-task writes go through `authorization.service`. | `packages/services/authorization.service.ts` | `packages/services/__tests__/authorization.service.test.ts` |

## 4. Investigate before you change

If you are new to this repository, do this before editing:

1. **Read the code, not just the docs.** Several docs under `docs/archive/`
   describe removed behavior (see §8). Code wins, always.
2. **Name the layer** your change touches: ingress classification → policy/mode
   gate → approval → lease → agent loop → tool grant → tool adapter →
   verification → retry/DLQ → socket bridge.
3. **Find the pinning test first.** Most invariants above have a dedicated test
   (§7). If you cannot find one, say so rather than assuming the behavior is
   unconstrained.
4. **Trace, then edit.** For "why did/didn't this task run", follow accept /
   `requestTaskExecution` / enqueue, then the outbox topic
   (`message.created`, `task.execution.requested`, `task.execution.approved`,
   `task.created`/`task.updated`, `task.cancel.requested`) through
   `apps/task-worker/index.ts` before touching anything. Cancel is
   `processTaskCancelRequested`.
5. **Separate observation from assumption** in what you report. Mark files you
   did not open as unverified.
6. **Reuse the existing pattern.** New tools mirror an existing
   `*.tool.ts`; new workflows extend `WorkflowTemplate` / `WorkflowRegistry`;
   new pure logic mirrors small tested helpers like `apps/task-worker/services/tool-ranking.ts` or
   `apps/task-worker/services/suggest-only-execution-gate.ts`. Do not introduce a parallel framework.
7. **Never weaken a gate to make something work.** If a change requires relaxing
   `suggest_only`, grants, prompt-guard, or idempotency, stop and surface it.

## 5. Where code belongs

| Concern | Home |
|---|---|
| Shared types, event/tool contracts | `packages/types` |
| Mongoose models/indexes | `packages/db/models` |
| Domain operations, policy overlays, outbox/enqueue boundaries | `packages/services` |
| HTTP APIs, request-path persistence | `apps/web/app/api` |
| Realtime fan-out, presence | `apps/socket` (transport only) |
| Outbox consumption, agent loop, tools | `apps/task-worker` |
| Logging, metrics, tracing | `@semantask/observability` |

## 6. Known leaky seams (do not mass-refactor)

These are real, pre-existing, and out of scope for unrelated changes:

- **Web API routes**: both patterns exist across `apps/web/app/api`. Some routes
  go through `@semantask/services`; others import `@semantask/db/models` or
  Mongoose directly. Follow the pattern of the route you are editing; do not
  migrate unrelated routes.
- **`@semantask/auth`** reaches models via `@/models/*` path aliases rather than
  `@semantask/db` (documented in `docs/architecture/shared-package-design.md`).
- **`apps/task-worker/services/agent/step-loop.ts`** is very large and owns both
  loop styles. Prefer extracting a tested pure helper over reformatting the file.

## 7. Testing and verification

**Build shared packages first.** Many tests import built output from
`packages/*/dist`. In a fresh or cleaned tree, many `apps/task-worker` files, some
`apps/socket` files, and the `notify.service` suite in `packages/services` fail with
`ERR_MODULE_NOT_FOUND … @semantask/db/dist/db.js` or
`TS2307 … @semantask/types/utils/internal-bridge-auth`. That is a missing build,
**not** a broken test. Run CI's step first, and again after editing a shared package:

```bash
pnpm exec turbo run build '--filter=./packages/*'
```

Two things can mislead you about the state of a build:

- `ts-jest` caches transforms, so a Jest suite can keep passing after `dist` is gone.
  Add `--no-cache` when a result looks wrong.
- In the worker, `tsx` follows `apps/task-worker/tsconfig.json` paths, so
  `@semantask/services/*` resolves to source while `@semantask/db` and
  `@semantask/types` resolve to `dist`.

Test runners differ per workspace — use the right one:

| Workspace | Runner | Command |
|---|---|---|
| `apps/task-worker` | `node:test` via `tsx` | `pnpm --filter @semantask/task-worker test` |
| `apps/socket` | `node:test` via `tsx` | `pnpm --filter @semantask/socket test` |
| `packages/services`, `packages/db` | Jest | `pnpm --filter @semantask/services test` |
| `packages/auth` | Vitest | `pnpm --filter @semantask/auth test` |
| `apps/web` | Jest (+ Playwright e2e) | `pnpm --filter @semantask/web test` |

Repo-wide (what CI runs): `pnpm run test`, `pnpm run typecheck`, `pnpm run lint`,
`pnpm run build`, `pnpm run ci:verify-artifacts`. Only `apps/web` defines `lint`, and
`packages/auth` has no `typecheck` script, so a green repo-wide run does not lint the
worker, socket, or packages.

Running a single test:

```bash
# Jest: path pattern, optional -t name filter
pnpm --filter @semantask/services test -t 'dedupe' __tests__/notify.service.test.ts
pnpm --filter @semantask/web test test/config.test.ts

# node:test: the package script hard-codes its glob, so call tsx directly
INTERNAL_SECRET=test-internal-secret TASK_TOOL_RBAC=off \
  pnpm --filter @semantask/task-worker exec tsx --test tests/execution-policy.test.ts
pnpm --filter @semantask/socket exec tsx --test tests/config.test.ts
# narrow by name with --test-name-pattern='explicit' before the file

# Vitest: pick the project; integration boots mongodb-memory-server and runs serially
pnpm --filter @semantask/auth exec vitest run -c vitest.config.ts --project unit \
  __tests__/otp.service.test.ts
pnpm --filter @semantask/auth exec vitest run -c vitest.config.ts --project integration \
  --no-file-parallelism --max-workers=1 __tests__/token-versioning.integration.test.ts

# Playwright: Docker Mongo :27018 and Redis :6380; starts web, socket, and worker
# with a curated env that does not inherit your .env
pnpm --filter @semantask/web exec playwright install chromium
pnpm --filter @semantask/web test:e2e:deps
pnpm --filter @semantask/web test:e2e e2e/landing.spec.ts
```

Worker test conventions:

- `apps/task-worker/tests/test-env.ts` sets `INTERNAL_SECRET`,
  `TASK_CLASSIFIER_MODE=regex` (to stay offline), and
  `DEFAULT_EXECUTION_MODE=auto_execute` **because production default
  `suggest_only` denies tools**. Import it in tests that exercise tool paths;
  never change the production default to make a test pass.
- The package script also sets `TASK_TOOL_RBAC=off`.
- Prefer pure-function tests (see `apps/task-worker/tests/suggest-only-execution-gate.test.ts`,
  `apps/task-worker/services/tool-ranking.ts`) over booting the worker. No live Resend/GitHub/webhook calls.

Invariant → pinning test map:

| Invariant | Test |
|---|---|
| suggest_only bypasses are narrow | `apps/task-worker/tests/suggest-only-execution-gate.test.ts` |
| mode gate + thresholds | `apps/task-worker/tests/execution-policy.test.ts` |
| enqueue refuses under suggest_only | `packages/services/__tests__/task-execution-enqueue.service.test.ts` |
| ingress stays suggest-first | `packages/services/__tests__/task-intelligence.suggest-only.test.ts` |
| tool idempotency is run-independent | `apps/task-worker/tests/idempotent-tool-execution.test.ts` |
| lease contention defers | `apps/task-worker/tests/dispatch.lease-wrapper.test.ts`, `apps/task-worker/tests/lease.contention.test.ts` |
| agent loop / cancellation | `apps/task-worker/tests/agent-runner.*.test.ts` |
| workflow resolution | `apps/task-worker/tests/workflow-registry.test.ts` |
| accept never enqueues execution | `packages/services/__tests__/work-suggestion.mutations.test.ts` |
| accept-creates-execution stays off | `packages/services/__tests__/config.flags.test.ts` |
| manager execution request | `apps/web/test/task-request-execution.route.test.ts` |
| notify dedupe | `packages/services/__tests__/notify.service.test.ts` |
| suggestion, approval, and coordination access | `packages/services/__tests__/authorization.service.test.ts` |

## 8. Documentation drift (verify before citing)

- `docs/archive/optional-autonomy/task-worker-execution-flow.md` and
  [ADR-002](docs/decisions/ADR-002-retry-orchestration-strategy.md) still
  describe a "legacy step plan" mode with inline `executeXxxAction` adapters and
  a dead `buildExecutionPlan` / `runExecutionPlan` block in
  `apps/task-worker/index.ts`. **That code was removed** (see TD-05 in
  `apps/task-worker/CHANGELOG.md`). Tools now run only through `ToolExecutor`.
- `docs/ARCHITECTURE.md` carries a verification date and commit; treat anything
  newer in code as authoritative. Its §4 still calls ingress regex-only and places
  `buildToolIdempotencyKey` on `AgentRunner`; the key now lives on `ToolExecutor`.
- `packages/redis` / `@semantask/redis` no longer exists, but `README.md`,
  `docs/ARCHITECTURE.md`, and `docs/architecture/shared-package-design.md` still
  describe it.
- `README.md` places `classifyMessage` in `task-intelligence.service.ts`, which only
  imports it. It is defined in `packages/services/message-classifier.service.ts`.
- Ingress classification defaults to the **LLM** (`TASK_CLASSIFIER_MODE` unset or
  `llm`), with regex fallback only when no API key is configured. A timeout or
  provider error is retried, then leaves the `message.created` event retryable
  and the message unclassified. `regex` and `shadow` remain explicit switches.
  LLMs are also used in optional execution (planning, decisions, reflection).

## 9. Change conventions

- **Do not change application behavior as a side effect** of a docs, test, or
  tooling task.
- Add a **changeset** (`pnpm changeset`) for user-visible or package-level
  changes; releases are Changesets-driven (`.github/RELEASES.md`).
- Security-relevant paths (auth, internal bridge secrets, tool grants,
  prompt-guard, email domain allowlists) require explicit reasoning in the PR
  description, not just passing tests.
- Keep async work **observable**: execution events, `logExecution`, metrics, and
  spans already exist — extend them rather than adding ad-hoc `console.log`.
- If information is missing or repository behavior is ambiguous, **stop and ask**
  rather than inventing an API, env var, topic, or tool name.

## 10. Reference map

- ADRs: [001 lifecycle](docs/decisions/ADR-001-task-lifecycle-state-machine.md) ·
  [002 retry](docs/decisions/ADR-002-retry-orchestration-strategy.md) ·
  [003 socket authz](docs/decisions/ADR-003-socket-authorization-bridge.md) ·
  [004 personal/orgs](docs/decisions/ADR-004-personal-and-optional-organizations.md) ·
  [005 suggest-first](docs/decisions/ADR-005-suggest-first-work-coordination.md)
- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
  [`docs/architecture/shared-package-design.md`](docs/architecture/shared-package-design.md)
- Operations: [`docs/operations/PRODUCTION_REQUIREMENTS.md`](docs/operations/PRODUCTION_REQUIREMENTS.md)
- Worker procedures: [`.agents/skills/*/SKILL.md`](.agents/skills/). Open the
  skill named in §1 before editing that layer. Coordination, notifications,
  web UI, auth, orgs, and socket handlers have no skill; use §3 and §2.
