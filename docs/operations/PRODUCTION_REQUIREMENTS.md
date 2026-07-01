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
| 3 | **`INTERNAL_SECRET` identical** on web, socket, task-worker | Internal bridge (`/internal/*`, `/api/internal/socket/*`) | Worker starts in `NODE_ENV=production`; socket internal routes accept worker emits |
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
| Retry scanner promote + enqueue | `apps/task-worker/services/retry-scheduler.ts` | **Fails every tick** — logs `task-worker retry.scanner_failed` |
| Retry scanner transaction | `runRetryScannerOnce` | Tasks stuck in `retry_scheduled` are not promoted |

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
| Task worker | Outbox dedupe skipped when `redis === null` — weaker at-least-once protection |
| Web | Depends on feature; rate limits may fail open or skip |

Root `docker-compose.yml` includes a `redis` service for socket and worker. **Render/Vercel production** must set `REDIS_URL` to a managed Redis (not omitted).

### Verify

```bash
redis-cli -u "$REDIS_URL" ping   # PONG
```

Confirm socket startup logs do not show the mock-adapter warning.

---

## Secrets and service auth

### `INTERNAL_SECRET` (required in production)

Shared header `x-internal-secret` secures:

- Socket `POST /internal/*` (worker and web → socket fan-out)
- Web `POST /api/internal/socket/*` (socket → web authorization)
- Web `POST /api/internal/auth/*`

**Must be:**

- The **same value** on web, socket, and task-worker
- Long, random, stored only in secrets managers / `.env` (never committed)
- Rotated with a coordinated redeploy of all three services (per-service secrets are Phase 3.4)

**Enforcement:**

- `packages/types/utils/internal-bridge-auth.ts` — `getInternalSecret()` throws if unset when building outbound headers
- `apps/task-worker/index.ts` — `assertInternalSecretConfigured()` throws at startup when `NODE_ENV=production` and secret is missing

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

**Production guidance:** leave shadow **enabled** (`!== "0"`) until Phase 5.2 projection cutover. Shadow is best-effort and does not drive indexes or UI today ([ADR-001](../decisions/ADR-001-task-lifecycle-state-machine.md)).

**Code:** `apps/task-worker/services/agent-runner.ts` — `isShadowExecutionStateEnabled()`.

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
| `INTERNAL_SECRET` | Yes | Yes | Yes |
| `SOCKET_SERVER_URL` / `WEB_SERVER_URL` | Yes | Yes | Yes (`SOCKET_SERVER_URL` for emits) |
| `LLM_*`, tool API keys | Optional on web | No | **Required** for agent runs |
| `ALLOWED_EMAIL_DOMAINS` | Optional | No | **Required** if email tools used |

---

## Failure modes (quick reference)

| Misconfiguration | User-visible / ops symptom |
|------------------|----------------------------|
| Standalone Mongo + task worker | Retries never promote; `retry.scanner_failed` every 5s |
| No Redis on socket (multi pod) | Clients on different pods miss realtime events |
| No Redis on worker | Duplicate outbox processing possible under race |
| Mismatched `INTERNAL_SECRET` | Task updates never reach clients; 401 on internal routes |
| Missing `INTERNAL_SECRET` (prod worker) | Worker refuses to start |
| Empty email allowlist + email tool | Sends to arbitrary domains may auto-execute |
| `ORIGIN` mismatch | Socket connection rejected |

---

## References

- Deploy pipeline: [`.github/RELEASES.md`](../../.github/RELEASES.md)
- Security detail: [`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md)
- Retry / replica set: [ADR-002](../decisions/ADR-002-retry-orchestration-strategy.md) §Scalability
- Gap item P1-7 (replica-set documentation): [gap audit](../architecture/adr-implementation-gap-audit.md)
