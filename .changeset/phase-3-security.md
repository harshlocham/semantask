---
"@semantask/task-worker": minor
"@semantask/web": minor
"@semantask/socket": patch
"@semantask/db": minor
"@semantask/types": minor
"@semantask/services": minor
---

## Runtime

Phase 3 Security — prompt injection boundaries, tool RBAC, execution audit trail, and per-service internal secrets (Production Roadmap 3.1–3.4).

### Added

- Prompt guard (`TASK_PROMPT_GUARD=off|monitor|enforce`) with untrusted content fencing and participant/contact validation for email/meeting tools
- `ToolGrant` model + admin grant/revoke/seed API and UI; `TASK_TOOL_RBAC=off|enforce`
- Append-only `ExecutionAuditLog` dual-write on tool start/complete/deny/approval + `GET /api/admin/execution-audit`
- Per-service secrets: `INTERNAL_SECRET_SOCKET` / `INTERNAL_SECRET_WORKER` (+ `*_PREVIOUS` rotation) with legacy `INTERNAL_SECRET` fallback
- Threat model doc, rotation runbook, and unit tests

### Updated

- Planner and agent-runner fence task title/description before LLM calls
- Execution policy and agent execute path enforce prompt-guard + tool grants
- Socket and web internal bridges use audience-aware secret validation
- Production requirements / roadmap acceptance for 3.1–3.4

### Compatibility

- Prompt guard and tool RBAC default to `off`; enable after staging monitor / grant seed
- Legacy `INTERNAL_SECRET` still accepted on both audiences during the deprecation window
- Worker secret alone cannot authorize web `/api/internal/*` once per-service secrets are configured
