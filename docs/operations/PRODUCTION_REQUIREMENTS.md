# Production Requirements

**Status:** Active runbook  
**Last updated:** 2026-07-01  
**Roadmap:** [Production Roadmap V1](../PRODUCTION_ROADMAP_V1.md) — Phase 0.3  
**Related:** [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md), [ADR-002](../decisions/ADR-002-retry-orchestration-strategy.md), [gap audit](../architecture/adr-implementation-gap-audit.md)

This document lists infrastructure and configuration that production deployments **must** satisfy. Missing items often fail **silently** (degraded mode) rather than preventing startup.

---

## Pre-deploy checklist

Use this before promoting **staging** or **production** (web, socket, and task worker).

| # | Requirement | Required for | Verify |
|---|-------------|--------------|--------|
| 1 | **MongoDB replica set** (or `mongos`) | Task retry scanner, transactional message+outbox writes | `rs.status()` succeeds; no `Transaction numbers are only allowed on a replica set` in worker logs |
| 2 | **`REDIS_URL` reachable** from web, socket, task-worker | Socket.IO horizontal scale, outbox dedupe, presence, rate limits | Socket log does **not** show Redis adapter mock warning; worker has Redis connected |
| 3 | **Per-service internal secrets** (`INTERNAL_SECRET_SOCKET` / `INTERNAL_SECRET_WORKER`, or legacy `INTERNAL_SECRET`) | Internal bridge (`/internal/*`, `/api/internal/*`) | Worker starts in prod; socket accepts worker emits; see [rotation runbook](./INTERNAL_SECRET_ROTATION.md) |
| 4 | **Auth secrets** (`ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `NEXTAUTH_SECRET`) | Web + socket JWT validation | Login and socket handshake succeed |
| 5 | **`ORIGIN` / `NEXT_PUBLIC_SOCKET_URL` aligned** with public URLs | CORS and socket connections | Browser connects to `/api/socket` without origin errors |
| 6 | **`TASK_EXECUTION_FSM_SHADOW_MODE` understood** | FSM shadow telemetry (default: on) | Set `0` only when intentionally disabling shadow writes |
| 7 | **`ALLOWED_EMAIL_DOMAINS` or `TASK_WORKER_ALLOWED_EMAIL_DOMAINS`** when email tools are enabled | Autonomous `send_email` policy | Comma-separated domains; empty = no domain restriction (higher risk) |
| 8 | **LLM + tool credentials** (`LLM_*`, `RESEND_API_KEY`, etc.) | Task execution | Worker logs show successful provider startup |

Copy this table into release notes when cutting a production deploy ([`.github/RELEASES.md`](../../.github/RELEASES.md)).

---

## MongoDB

### Requirement: replica set

Several paths use MongoDB multi-document transactions:

| Path | File | Behavior without replica set |
|------|------|------------------------------|
| Message create + outbox enqueue | `packages/services/message.service.ts` | Falls back to non-transactional write (weaker atomicity) |
| Retry scanner promote + enqueue | `apps/task-worker/services/retry-scheduler.ts` | Falls back to non-transactional promote+enqueue (weaker atomicity; same as message create) |
| Retry scanner transaction | `runRetryScannerOnce` | On standalone Mongo, uses fallback path — no longer logs `retry.scanner_failed` every tick |

**Production:** use MongoDB Atlas replica set, a self-hosted replica set, or `mongos`. A standalone `mongod` is acceptable for **local dev only**.

### Connection string

- Set `MONGODB_URI` on **web**, **socket** (if it reads DB for auth bridge callbacks via web), and **task-worker**.
- Root `docker-compose.yml` does **not** include MongoDB — operators must provide an external instance.

### Verify

```bash
# From a host that can reach MongoDB
mongosh "$MONGODB_URI" --eval 'rs.status().ok'   # expect 1 on replica set
```

Watch task-worker logs for `retry.scanner_failed` with transaction errors.

---

## Redis

### Requirement: shared Redis for production

| Consumer | Use |
|----------|-----|
| **Socket** (`apps/socket`) | `@socket.io/redis-adapter` for cross-pod fan-out; app presence/delivery keys |
| **Web** (`apps/web`) | Rate limiting (`@upstash/ratelimit` when configured), auth user cache patterns |
| **Task worker** | Outbox processed-event dedupe (`task-worker:processed:*`), optional coordination |

### Silent degradation without Redis

| Service | Symptom |
|---------|---------|
| Socket | `Running socket server without Redis adapter (development mock mode)` — **single pod only**, no cross-instance rooms |
| Task worker | Outbox dedupe skipped when `redis === null` — weaker at-least-once protection (**production refuses to start** unless `TASK_WORKER_ALLOW_NO_REDIS=1`) |
| Web | Depends on feature; rate limits may fail open or skip |

Root `docker-compose.yml` includes a `redis` service for socket and worker. **Render/Vercel production** must set `REDIS_URL` to a managed Redis (not omitted).

### Verify

```bash
redis-cli -u "$REDIS_URL" ping   # PONG
```

Confirm socket startup logs do not show the mock-adapter warning.

### Task-worker Redis enforcement (Phase 6.3)

In `NODE_ENV=production`, task-worker requires `REDIS_URL` or `UPSTASH_REDIS_REST_URL` and exits on missing config. Emergency override: `TASK_WORKER_ALLOW_NO_REDIS=1` (dedupe remains skipped).

### Outbox worker partitions (Phase 6.3)

Optional horizontal scale for outbox claiming:

| Variable | Default | Effect |
|----------|---------|--------|
| `OUTBOX_PARTITION_COUNT` | `1` | Number of stable shards (`$toHashedIndexKey($_id) % count`) |
| `OUTBOX_PARTITION_ID` | `0` | Shard owned by this replica (`0 .. count-1`) |

Deploy **one worker replica per partition id** (e.g. count=`3` → three replicas with ids `0`, `1`, `2`). Leave count at `1` for single-worker installs.

### Outbox retention / archival (Phase 6.4)

| Variable | Default | Effect |
|----------|---------|--------|
| `OUTBOX_RETENTION_DAYS` | `14` | Delete `completed` / `dead_letter` rows older than this |
| `OUTBOX_ARCHIVE_INTERVAL_MS` | `3600000` (1h) | Archival job tick interval |

Pending / failed / processing rows are never archived.

### Retry scanner batch (Phase 6.2)

| Variable | Default | Effect |
|----------|---------|--------|
| `TASK_RETRY_BATCH_SIZE` | `10` | Max due retries promoted per scanner tick |

---

## Secrets and service auth

### `INTERNAL_SECRET` / per-service secrets (required in production)

Header `x-internal-secret` secures:

- Socket `POST /internal/*` (web + worker → socket fan-out) — accepts `INTERNAL_SECRET_SOCKET` (+ `*_PREVIOUS` + legacy `INTERNAL_SECRET`)
- Web `POST /api/internal/socket/*` and `/api/internal/auth/*` — accepts `INTERNAL_SECRET_WORKER` (+ `*_PREVIOUS` + legacy `INTERNAL_SECRET`)

**Preferred (Phase 3.4):**

| Variable | Held by | Accepted by |
|----------|---------|-------------|
| `INTERNAL_SECRET_SOCKET` | web, task-worker | socket |
| `INTERNAL_SECRET_WORKER` | socket, web middleware | web `/api/internal/*` |

Legacy `INTERNAL_SECRET` remains accepted on both audiences for a two-release deprecation window.

**Must be:**

- Long, random, stored only in secrets managers / `.env` (never committed)
- Rotated with the [Internal Secret Rotation Runbook](./INTERNAL_SECRET_ROTATION.md) (supports `*_PREVIOUS` for zero-downtime)

**Enforcement:**

- `packages/types/utils/internal-bridge-auth.ts` — audience-aware headers and validation
- `apps/task-worker/index.ts` — requires `INTERNAL_SECRET_SOCKET` or legacy `INTERNAL_SECRET` in production
- `apps/socket/index.ts` — `assertInternalAudienceConfigured("socket")` at boot

See also: [`INTERNAL_SECRET_ROTATION.md`](./INTERNAL_SECRET_ROTATION.md).

### ToolGrant index migration (Phase 7)

After deploying the org-scoped ToolGrant unique index, run once against production Mongo.

**1. Preflight — scan for duplicate active grants** before dropping `uniq_active_tool_grant`. Resolve any groups with `count > 1` (same `userId` + `toolName` + `conversationId` + `organizationId`, `revokedAt: null`); an org/tool collision will also show up in this grouping:

```js
db.toolgrants.aggregate([
  { $match: { revokedAt: null } },
  {
    $group: {
      _id: {
        userId: "$userId",
        toolName: "$toolName",
        conversationId: "$conversationId",
        organizationId: "$organizationId",
      },
      count: { $sum: 1 },
      ids: { $push: "$_id" },
    },
  },
  { $match: { count: { $gt: 1 } } },
])
```

**2. Migrate** (drops legacy `uniq_active_tool_grant` without `organizationId` if present, then `syncIndexes()`):

```bash
MONGODB_URI=... pnpm --filter @semantask/db exec node ./scripts/migrate-tool-grant-index.mjs
```

**3. Rollback** if `syncIndexes()` fails after the legacy index was dropped — recreate the pre-org unique index, then re-run preflight and migrate after fixing data:

```js
db.toolgrants.createIndex(
  { userId: 1, toolName: 1, conversationId: 1 },
  {
    unique: true,
    partialFilterExpression: { revokedAt: null },
    name: "uniq_active_tool_grant",
  }
)
```

**4. Post-sync verification** — confirm the org-scoped unique index exists and duplicates are absent:

```js
// Expect key: userId, toolName, conversationId, organizationId
db.toolgrants.getIndexes().find((idx) => idx.name === "uniq_active_tool_grant")

// Must return no documents
db.toolgrants.aggregate([
  { $match: { revokedAt: null } },
  {
    $group: {
      _id: {
        userId: "$userId",
        toolName: "$toolName",
        conversationId: "$conversationId",
        organizationId: "$organizationId",
      },
      count: { $sum: 1 },
    },
  },
  { $match: { count: { $gt: 1 } } },
])
```

### Organization context (Phase 7.1)

| Header | Purpose |
|--------|---------|
| `X-Organization-Id` | Optional. When set after auth, scopes conversation list/create and related APIs to that org. Omit for personal workspace. User must be an active member. See [ADR-004](../decisions/ADR-004-personal-and-optional-organizations.md). |

### Other required secrets (web)

| Variable | Purpose |
|----------|---------|
| `ACCESS_TOKEN_SECRET` | JWT access tokens (socket + API) |
| `REFRESH_TOKEN_SECRET` | Refresh tokens |
| `NEXTAUTH_SECRET` | NextAuth session encryption |
| `NEXTAUTH_URL` | Canonical app URL |

See [`env.sample`](../../env.sample) for the full list.

---

## Task worker: FSM shadow mode

Fine-grained execution state is persisted in **shadow mode** alongside legacy `Task.lifecycleState`.

| Variable | Default | Effect |
|----------|---------|--------|
| `TASK_EXECUTION_FSM_SHADOW_MODE` | on (any value except `"0"`) | `AgentRunner` writes `Task.executionState` + `stateHistory` |
| `TASK_EXECUTION_FSM_SHADOW_MODE=0` | off | Shadow FSM writes disabled; legacy lifecycle remains authoritative |
| `TASK_STATE_DIVERGENCE_CHECK` | off | Set to `1` to log `state_diverged` when `lifecycleState` ≠ FSM projection (Phase 1.1) |
| `TASK_POLICY_SHADOW_EMIT` | off | Set to `1` to emit `POLICY_BLOCKED` / `POLICY_APPROVAL_REQUIRED` on policy early returns and align `lifecycleState` with the FSM projection (Phase 1.2; requires shadow mode on) |
| `TASK_RETRY_SHADOW_EMIT` | off | Set to `1` to emit `RETRY_DUE` when the retry scanner promotes a task (Phase 1.3; requires shadow mode on) |

**Production guidance:** leave shadow **enabled** (`!== "0"`) until Phase 5.2 projection cutover. Enable `TASK_STATE_DIVERGENCE_CHECK=1` in staging/production task-worker to sample dual-state drift. Once divergence sampling looks clean, enable `TASK_POLICY_SHADOW_EMIT=1` to close the policy-path gap (blocked/approval requests otherwise leave the shadow FSM stale). Both flags are best-effort and do not drive indexes or UI today ([ADR-001](../decisions/ADR-001-task-lifecycle-state-machine.md)).

**Code:** `apps/task-worker/services/state-divergence-check.ts`, `policy-shadow.ts`, `retry-shadow.ts`, `retry-scheduler.ts`, `agent-runner.ts`.

---

## Task worker: email domain allowlist

Autonomous `send_email` actions are gated by `evaluateExecutionPolicy` (`apps/task-worker/services/execution-policy.ts`).

| Variable | Precedence |
|----------|------------|
| `TASK_WORKER_ALLOWED_EMAIL_DOMAINS` | Preferred |
| `ALLOWED_EMAIL_DOMAINS` | Fallback |

Format: comma-separated domains, case-insensitive (e.g. `example.com,mail.example.com`).

| Configuration | Behavior |
|---------------|----------|
| **Unset or empty** | No domain restriction — recipients outside your org may auto-execute if other policy checks pass |
| **Set** | Recipients whose domain is not listed → `approval_required` or blocked (high risk → blocked in `processTaskExecutionRequested`) |

**Production guidance:** set an explicit allowlist before enabling task worker deploy (`ENABLE_TASK_WORKER_DEPLOY=true`).

---

## Docker Compose (local / VPS)

### Root `docker-compose.yml`

Includes: `nginx`, `nextapp`, `socket`, `task-worker`, `redis`.  
**Does not include MongoDB** — set `MONGODB_URI` in `.env` to an external database.

### VPS task worker (`deploy/docker-compose.task-worker.yml`)

Minimal compose file; expects:

- `TASK_WORKER_IMAGE` — immutable digest ref from GHCR (set by CI)
- `.env` in `VPS_DEPLOY_PATH` with production values from this runbook

Deploy script: `scripts/ci/deploy/vps-task-worker.sh`.

---

## Per-environment matrix

| Component | Vercel (web) | Render (socket) | VPS (task worker) |
|-----------|--------------|-----------------|-------------------|
| `MONGODB_URI` | Yes | No (web handles DB) | Yes |
| `REDIS_URL` | Recommended | **Required** for multi-instance | **Required** |
| `INTERNAL_SECRET_SOCKET` | Yes (caller → socket) | Accepts inbound | Yes (caller → socket) |
| `INTERNAL_SECRET_WORKER` | Accepts inbound + middleware | Yes (caller → web) | No |
| `INTERNAL_SECRET` (legacy) | Transitional fallback | Transitional fallback | Transitional fallback |
| `SOCKET_SERVER_URL` / `WEB_SERVER_URL` | Yes | Yes | Yes (`SOCKET_SERVER_URL` for emits) |
| `LLM_*`, tool API keys | Optional on web | No | **Required** for agent runs |
| `ALLOWED_EMAIL_DOMAINS` | Optional | No | **Required** if email tools used |

Prefer distinct `INTERNAL_SECRET_SOCKET` / `INTERNAL_SECRET_WORKER`. Legacy `INTERNAL_SECRET` remains accepted on both audiences during the deprecation window — remove it after rotation (see [INTERNAL_SECRET_ROTATION.md](./INTERNAL_SECRET_ROTATION.md)).

---

## Failure modes (quick reference)

| Misconfiguration | User-visible / ops symptom |
|------------------|----------------------------|
| Standalone Mongo + task worker | Retries promote via non-transactional fallback (weaker atomicity); enable `TASK_RETRY_SHADOW_EMIT=1` to align shadow FSM on promote |
| No Redis on socket (multi pod) | Clients on different pods miss realtime events |
| No Redis on worker | Duplicate outbox processing possible under race; **production boot fails** unless `TASK_WORKER_ALLOW_NO_REDIS=1` |
| Missing Redis (prod worker) | Worker refuses to start (`REDIS_URL` / `UPSTASH_REDIS_REST_URL`) |
| Overlapping `OUTBOX_PARTITION_ID` | Two replicas may claim the same outbox `_id` — use one replica per partition id |
| Mismatched `INTERNAL_SECRET_SOCKET` / callers vs socket | Task updates never reach clients; 401 on socket `/internal/*` |
| Mismatched `INTERNAL_SECRET_WORKER` / callers vs web | Socket authz / step-up bridges fail; 401 on web `/api/internal/*` |
| Missing socket secret (prod worker) | Worker refuses to start (`INTERNAL_SECRET_SOCKET` or legacy `INTERNAL_SECRET`) |
| Empty email allowlist + email tool | Sends to arbitrary domains may auto-execute |
| `ORIGIN` mismatch | Socket connection rejected |

---

## References

- Deploy pipeline: [`.github/RELEASES.md`](../../.github/RELEASES.md)
- Security detail: [`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md)
- Retry / replica set: [ADR-002](../decisions/ADR-002-retry-orchestration-strategy.md) §Scalability
- Gap item P1-7 (replica-set documentation): [gap audit](../architecture/adr-implementation-gap-audit.md)
