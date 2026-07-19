---
"@semantask/services": minor
"@semantask/task-worker": minor
"@semantask/db": minor
"@semantask/web": minor
---

 Enterprise — personal workspace + optional organizations, org policy overlays, usage metering and quotas 

### Added
- `Organization` / `OrganizationMembership` with owner|admin|member roles
- Optional `organizationId` on Conversation, Task, ToolGrant, ExecutionAuditLog
- `OrganizationPolicy`, `OrganizationQuota`, `UsageEvent`
- Org CRUD/members/policy/quota APIs; `X-Organization-Id` context; ADR-004
- Execution policy + ToolGrant org overlays; billing outbox topics + `/api/internal/billing/events`
