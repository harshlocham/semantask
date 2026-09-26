<div align="center">

# Semantask

**Teams talk. AI extracts the work. Managers stay in control.**

Conversation becomes reviewable suggestions. Autonomy is optional — not the product promise.

[Architecture](docs/ARCHITECTURE.md) · [ADR-005](docs/decisions/ADR-005-suggest-first-work-coordination.md)

[![CI](https://github.com/harshlocham/semantask/actions/workflows/node.js.yml/badge.svg)](https://github.com/harshlocham/semantask/actions/workflows/node.js.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org/)
[![Next.js](https://img.shields.io/badge/web-Next.js_15-black)](https://nextjs.org/)
[![Turborepo](https://img.shields.io/badge/monorepo-Turborepo-EF4444)](https://turbo.build/)

</div>

- **Who it's for** — teams that already talk in chat and need extracted work a manager can review.
- **What it does** — turns conversation into suggestions, approvals, and org-wide status. Tools run only when policy allows.
- **How to try it** — there is no hosted demo right now. Run it locally with the quick start below.

<p align="center">
  <img src="docs/screenshots/semantask-dashboard.png" alt="Semantask conversation with AI work suggestions ready to review" width="920" />
  <br />
  <sub>Chat stays the source of truth. Extracted work shows up as suggestions you can dismiss or approve.</sub>
</p>

<p align="center">
  <img src="docs/screenshots/semantask-inbox.png" alt="Semantask suggestions inbox for reviewing extracted work" width="920" />
  <br />
  <sub>The inbox is for review — accept, assign, or dismiss before anything becomes a task.</sub>
</p>

## Quick start

```bash
pnpm install
cp env.sample .env   # set MongoDB, Redis, and auth secrets
pnpm run dev
```

Then open **http://localhost:3000** (socket server on **http://localhost:3001**).

Need the worker in isolation? `pnpm run task-worker`. Full env notes are in [Environment](#environment-configuration).

## Why Semantask

| Theme | What you get |
| --- | --- |
| **Suggest-first extraction** | Chat → proposed work you review before side effects. |
| **Manager control** | Approvals, tool grants, org policy, and audit trails. |
| **Org visibility** | Personal workspace by default; optional organizations ([ADR-004](docs/decisions/ADR-004-personal-and-optional-organizations.md)). |
| **Realtime collaboration** | Socket.IO for messages, presence, and work updates. |
| **Optional autonomy** | Multi-provider LLM worker when policy allows. |

Product contract: suggest → (approve when policy requires) → coordinate. False tool side effects under effective `suggest_only` are a P0. See [ADR-005](docs/decisions/ADR-005-suggest-first-work-coordination.md). Roadmap lives in Notion, not this repo.

## Architecture

```mermaid
flowchart LR
  subgraph Control plane
    Web[Next.js app]
    API[API routes]
  end
  subgraph Data
    Mongo[(MongoDB)]
    Redis[(Redis)]
  end
  subgraph Execution
    Worker[task-worker]
    LLM[LLM provider layer]
  end
  Socket[Socket.IO server]
  Web --> API
  API --> Mongo
  API --> Redis
  Worker --> Mongo
  Worker --> Redis
  Worker --> LLM
  Worker --> Socket
  Socket --> Redis
  Web --- Socket
```

1. **Next.js** serves the UI and HTTP APIs; shared packages enforce validation and persistence.
2. **task-worker** classifies messages and (when policy allows) runs optional autonomous tasks via the LLM provider layer.
3. **MongoDB** stores durable conversations, suggestions/tasks, and domain state.
4. **Redis** backs coordination, queues, and scalable socket fan-out.
5. **Socket.IO** streams chat and work updates for realtime clients.

Full system map: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Optional LLM/worker operator docs: [`docs/archive/optional-autonomy/`](docs/archive/optional-autonomy/).

**Ingress:** new chat messages are classified with `classifyMessage()` in `packages/services/task-intelligence.service.ts` on the **regex/heuristic** path (`TASK_CLASSIFIER_MODE` defaults to `regex`). LLM providers are used for optional **task execution**; `shadow` / `llm` ingress modes exist but are not the default.

## Platform stack

| Layer | Technology |
| --- | --- |
| Monorepo | **Turborepo** — unified build, cache-friendly pipelines |
| Web | **Next.js 15** — App Router, API routes, auth integration |
| Data | **MongoDB** — durable tasks and application state (external to Compose) |
| Coordination | **Redis** — queues, presence-style coordination, socket scaling |
| Real-time | **Socket.IO** — streaming updates to connected clients |
| Containers | **Docker Compose** — nginx, web, socket, worker, and Redis |

## Monorepo layout

```text
.
├── apps/
│   ├── web/           # Next.js — UI, APIs, auth flows
│   ├── socket/        # Socket.IO — real-time observability transport
│   ├── task-worker/   # Task-intelligence/outbox worker; optional AgentRunner + tools when policy allows
│   └── mobile/        # React Native client (optional)
├── packages/
│   ├── auth/          # Shared auth utilities
│   ├── db/            # MongoDB models and access patterns
│   ├── redis/         # Redis helpers
│   ├── services/      # Domain logic, validators, repositories
│   └── types/         # Shared contracts and event shapes
├── docker/
├── nginx/
├── docker-compose.yml
└── turbo.json
```

## Prerequisites

- **Node.js** 24+ (see `.nvmrc` and `engines` in `package.json`)
- **pnpm** 11+ (see `packageManager` in root `package.json`)
- **MongoDB** (replica set for production — see [`docs/operations/PRODUCTION_REQUIREMENTS.md`](docs/operations/PRODUCTION_REQUIREMENTS.md))
- **Redis** (required for production-like / multi-instance socket and task-worker dedupe)

## Environment configuration

Copy [`env.sample`](env.sample) to `.env` at the repository root and adjust for your environment.

**Core:** database, Redis, auth secrets (`ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET`), OAuth (optional), ImageKit (if media uploads are enabled), Resend (OTP, invites, and notifications).

**Task-worker runtime:** `TASK_*`, outbox/lease, and Redis settings in `env.sample` (needed for classification and outbox processing even when tools are off).

**Optional LLM / autonomy providers:** set `LLM_PROVIDER`, `LLM_API_KEY`, and `LLM_BASE_URL` when policy-enabled tool execution is used. Supports **OpenAI**, **OpenAI-compatible** bases (including **AMD**), and **Hugging Face**. See `env.sample`.

```env
# Core (abbreviated — see env.sample for the full list)
MONGODB_URI=mongodb://localhost:27017/semantask
ACCESS_TOKEN_SECRET=replace_with_a_strong_secret
REFRESH_TOKEN_SECRET=replace_with_a_strong_secret
INTERNAL_SECRET=replace_with_shared_internal_secret
ORIGIN=http://localhost:3000
REDIS_URL=redis://localhost:6379
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001

# Optional LLM / autonomy settings (see env.sample)
LLM_PROVIDER=openai
LLM_API_KEY=
# LLM_BASE_URL=             # OpenAI-compatible / vLLM / custom gateway
```

## Scripts

| Script | Description |
| --- | --- |
| `pnpm run dev` | Development mode for apps and packages via Turborepo |
| `pnpm run build` | Production builds across workspaces |
| `pnpm run start` | Starts production targets where defined |
| `pnpm run lint` | Lint across workspaces |
| `pnpm run test` | Tests across workspaces |
| `pnpm run task-worker` | Dev mode for the agent/task worker |
| `pnpm run clean` | Cleans build artifacts via Turborepo |

## Docker

```bash
docker compose up --build
```

The Compose stack includes **nginx**, **nextapp** (Next.js), **socket**, **task-worker**, and **Redis**. **MongoDB is not in Compose** — set `MONGODB_URI` in `.env` to a reachable instance (replica set required for production task-worker retries). See [`docs/operations/PRODUCTION_REQUIREMENTS.md`](docs/operations/PRODUCTION_REQUIREMENTS.md).

## Releases

GitHub Release tags track package versions and can lag `main`. See [`CHANGELOG.md`](CHANGELOG.md) for what actually shipped.

## Contributing

This repo is set up for local `pnpm` development. After `pnpm install`, `pnpm test` is the default check. Repository invariants and where code belongs live in [`AGENTS.md`](AGENTS.md).

## Troubleshooting

- **Ports 3000 / 3001 in use** — stop conflicting processes and restart dev servers.
- **Auth failures** — verify `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, and cookie/domain settings.
- **Socket / live updates** — check `ORIGIN`, `INTERNAL_SECRET`, and `NEXT_PUBLIC_SOCKET_URL`.
- **Agent or LLM errors** — confirm `LLM_PROVIDER`, API keys, and base URLs; for OSS endpoints, see [`docs/archive/optional-autonomy/oss-inference-compatibility.md`](docs/archive/optional-autonomy/oss-inference-compatibility.md).

## License

[MIT](LICENSE)
