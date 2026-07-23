# ADR-004: Personal Workspace + Optional Organizations

- Status: Accepted
- Scope: `packages/db/models/Organization*`, `packages/services/organization.service.ts`,
  `packages/services/authorization.service.ts`, web `/api/organizations/*`,
  conversation/task `organizationId` fields
- Related: [ADR-003](./ADR-003-socket-authorization-bridge.md),
  [PRODUCTION_ROADMAP_V1.md](../PRODUCTION_ROADMAP_V1.md) Phase 7.1

## Context

Phase 7 requires enterprise tenancy without breaking the existing personal chat
product. Users already have conversations and tasks with no tenant boundary.
Forcing every user into an organization would be a breaking migration and would
complicate single-player / small-team usage.

## Decision

1. **Personal workspace is the default.** Resources without `organizationId`
   (null / missing) are personal. No header required.
2. **Organizations are additive.** Users may create/join zero or more orgs via
   `Organization` + `OrganizationMembership` (`owner` | `admin` | `member`).
3. **Active org context** is request-scoped via `X-Organization-Id` after auth.
   Omit the header for personal context. JWT claims are not required in v1.
4. **Org-scoped resources** (`Conversation`, `Task`, optional `ToolGrant`) set
   `organizationId`. Access requires active membership **and** conversation
   participation (for conversations). Platform `User.role === "admin"` bypass
   remains for support/ops (`allowAdminBypass`).
5. **Participants** of an org conversation must all be org members.
6. **Tasks inherit** `organizationId` from their conversation at create time.
7. **Socket bridge** continues to authorize via conversation id; membership is
   enforced when the conversation document carries `organizationId`.

## Consequences

- Existing data needs no backfill.
- List/create conversation APIs filter by active org header vs personal.
- Org suspension (`Organization.status = suspended`) blocks organization
  execution paths (task-worker refuses new autonomous runs for suspended orgs).
- Policy (7.2) and quotas (7.3) attach to `organizationId` only; personal remains
  env-driven / unlimited.

## Non-goals (v1)

SSO/SAML, forcing all users into an org, cross-org DMs, JWT org claims.
