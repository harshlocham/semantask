"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    useCreateOrganization,
    useCreateOrganizationInvitation,
    useLeaveOrganization,
    useOrganizationInvitations,
    useOrganizationMembers,
    useOrganizationsList,
    useRemoveOrganizationMember,
    useResendOrganizationInvitation,
    useRevokeOrganizationInvitation,
    useUpdateOrganizationMemberRole,
    useUpdateOrganizationPolicy,
    useUpdateOrganizationQuota,
} from "@/lib/queries/use-organizations";
import { UserChip } from "@/components/people/user-chip";
import { writeActiveOrganizationId, readActiveOrganizationId } from "@/hooks/useActiveOrganizationId";
import { getOrganizationPolicy, getOrganizationUsage, listOrganizationToolGrants } from "@/lib/utils/api";
import { cn } from "@/lib/utils/utils";

type SettingsTab = "members" | "policy" | "usage";

const SECTION = "rounded-xl border border-border bg-card";
const SECTION_HEADER = "flex min-h-10 items-center justify-between gap-2 border-b border-border px-4 py-2";
const SECTION_TITLE = "text-sm font-semibold text-foreground";
const FIELD_LABEL = "text-xs font-medium text-foreground";
const SELECT = "flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm";

export default function OrganizationsPage() {
    const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
    const [tab, setTab] = useState<SettingsTab>("members");
    const [createOpen, setCreateOpen] = useState(false);
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);

    const orgsQuery = useOrganizationsList();
    const membersQuery = useOrganizationMembers(activeOrgId);
    const invitationsQuery = useOrganizationInvitations(activeOrgId);
    const createMutation = useCreateOrganization();
    const inviteMutation = useCreateOrganizationInvitation(activeOrgId);
    const revokeMutation = useRevokeOrganizationInvitation(activeOrgId);
    const resendMutation = useResendOrganizationInvitation(activeOrgId);
    const removeMemberMutation = useRemoveOrganizationMember(activeOrgId);
    const roleMutation = useUpdateOrganizationMemberRole(activeOrgId);
    const leaveMutation = useLeaveOrganization();

    const orgs = orgsQuery.data ?? [];
    const members = membersQuery.data ?? [];
    const invitations = invitationsQuery.data ?? [];
    const loading = orgsQuery.isLoading;

    useEffect(() => {
        if (!orgsQuery.data) return;
        const stored = readActiveOrganizationId();
        if (stored && orgsQuery.data.some((org) => org.id === stored)) {
            setActiveOrgId(stored);
            return;
        }
        if (stored) {
            setActiveOrgId(null);
            writeActiveOrganizationId(null);
        }
    }, [orgsQuery.data]);

    useEffect(() => {
        if (orgsQuery.error) {
            setError(
                orgsQuery.error instanceof Error
                    ? orgsQuery.error.message
                    : "Failed to load organizations"
            );
        }
    }, [orgsQuery.error]);

    useEffect(() => {
        if (membersQuery.error) {
            setError(
                membersQuery.error instanceof Error
                    ? membersQuery.error.message
                    : "Failed to load members"
            );
        }
    }, [membersQuery.error]);

    function selectOrg(id: string | null) {
        setActiveOrgId(id);
        writeActiveOrganizationId(id);
        const selected = orgs.find((org) => org.id === id);
        setStatus(
            id
                ? `Active organization: ${selected?.name ?? "Organization"}`
                : "Personal workspace selected."
        );
    }

    async function handleCreate() {
        setError(null);
        setStatus(null);
        try {
            const org = await createMutation.mutateAsync({
                name: name.trim(),
                slug: slug.trim() || undefined,
            });
            setName("");
            setSlug("");
            setStatus(`Created ${org.name}`);
            selectOrg(org.id);
        } catch (createError) {
            setError(createError instanceof Error ? createError.message : "Failed to create organization");
        }
    }

    async function handleInvite() {
        if (!activeOrgId) return;
        setError(null);
        try {
            const invitation = await inviteMutation.mutateAsync({
                email: inviteEmail.trim(),
                role: inviteRole,
            });
            setInviteEmail("");
            if (invitation.emailSent) {
                setStatus(`Invite sent to ${invitation.email}`);
            } else if (invitation.inviteUrl) {
                setStatus(`Invite created for ${invitation.email}. Share link: ${invitation.inviteUrl}`);
            } else {
                setStatus(`Invite created for ${invitation.email}`);
            }
        } catch (inviteError) {
            setError(inviteError instanceof Error ? inviteError.message : "Failed to invite");
        }
    }

    async function handleRevoke(invitationId: string) {
        setError(null);
        try {
            await revokeMutation.mutateAsync(invitationId);
            setStatus("Invitation revoked.");
        } catch (revokeError) {
            setError(revokeError instanceof Error ? revokeError.message : "Failed to revoke");
        }
    }

    async function handleResend(invitationId: string) {
        setError(null);
        try {
            await resendMutation.mutateAsync(invitationId);
            setStatus("Invitation resent.");
        } catch (resendError) {
            setError(resendError instanceof Error ? resendError.message : "Failed to resend");
        }
    }

    async function handleRemoveMember(userId: string) {
        setError(null);
        try {
            await removeMemberMutation.mutateAsync(userId);
            setStatus("Member removed.");
        } catch (removeError) {
            setError(removeError instanceof Error ? removeError.message : "Failed to remove member");
        }
    }

    async function handleChangeRole(userId: string, role: string) {
        setError(null);
        try {
            await roleMutation.mutateAsync({ userId, role });
            setStatus("Role updated.");
        } catch (roleError) {
            setError(roleError instanceof Error ? roleError.message : "Failed to change role");
        }
    }

    async function handleLeave() {
        if (!activeOrgId) return;
        setError(null);
        try {
            await leaveMutation.mutateAsync(activeOrgId);
            selectOrg(null);
            setStatus("You left the organization.");
        } catch (leaveError) {
            setError(leaveError instanceof Error ? leaveError.message : "Failed to leave");
        }
    }

    const pendingInvites = invitations.filter((invite) => invite.status === "pending");
    const acceptedInvites = invitations.filter((invite) => invite.status === "accepted");
    const activeOrg = orgs.find((org) => org.id === activeOrgId);
    const canManage = activeOrg?.role === "owner" || activeOrg?.role === "admin";
    const canLeave = activeOrg?.role === "member" || activeOrg?.role === "admin";

    const tabs: Array<{ value: SettingsTab; label: string; count?: number }> = [
        { value: "members", label: "Members", count: members.length },
        { value: "policy", label: "Policy & quotas" },
        { value: "usage", label: "Usage & permissions" },
    ];

    return (
        <div className="w-full max-w-6xl space-y-4 px-4 py-4 lg:px-5" data-testid="organizations-page">
            <section className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0 space-y-1.5">
                    <p className="text-xs text-muted-foreground">
                        Your active organization scopes the inbox, approvals, and board.
                    </p>
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Active workspace">
                        <Button
                            size="sm"
                            className="h-8"
                            variant={activeOrgId === null ? "default" : "outline"}
                            onClick={() => selectOrg(null)}
                        >
                            Personal
                        </Button>
                        {orgs.map((org) => (
                            <Button
                                key={org.id}
                                size="sm"
                                className="h-8"
                                variant={activeOrgId === org.id ? "default" : "outline"}
                                onClick={() => selectOrg(org.id)}
                                data-testid="organization-option"
                            >
                                {org.name}
                                <span className="font-normal opacity-70">· {org.role}</span>
                            </Button>
                        ))}
                    </div>
                    {loading ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
                </div>

                <Button
                    size="sm"
                    variant="outline"
                    className="h-8 self-start sm:hidden"
                    aria-expanded={createOpen}
                    onClick={() => setCreateOpen((open) => !open)}
                >
                    New organization
                </Button>
                <div
                    className={cn(
                        "w-full flex-col gap-2 sm:flex sm:flex-row lg:w-auto",
                        createOpen ? "flex" : "hidden"
                    )}
                    aria-label="Create organization"
                    role="group"
                >
                    <Input
                        className="h-8 lg:w-52"
                        placeholder="New organization name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        data-testid="organization-name"
                    />
                    <Input
                        className="h-8 lg:w-36"
                        placeholder="Slug (optional)"
                        value={slug}
                        onChange={(e) => setSlug(e.target.value)}
                        data-testid="organization-slug"
                    />
                    <Button
                        size="sm"
                        className="h-8"
                        variant="outline"
                        onClick={() => void handleCreate()}
                        disabled={!name.trim() || createMutation.isPending}
                        data-testid="organization-create"
                    >
                        Create organization
                    </Button>
                </div>
            </section>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {status ? <p className="break-all text-sm text-emerald-700 dark:text-emerald-400">{status}</p> : null}

            {activeOrgId ? (
                <>
                    <div className="flex overflow-x-auto border-b border-border" role="tablist" aria-label="Organization settings">
                        {tabs.map((item) => {
                            const active = tab === item.value;
                            return (
                                <button
                                    key={item.value}
                                    type="button"
                                    role="tab"
                                    aria-selected={active}
                                    className={cn(
                                        "-mb-px inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[13px] font-medium transition-colors",
                                        active
                                            ? "border-primary text-foreground"
                                            : "border-transparent text-muted-foreground hover:text-foreground"
                                    )}
                                    onClick={() => setTab(item.value)}
                                >
                                    {item.label}
                                    {typeof item.count === "number" && item.count > 0 ? (
                                        <span className="rounded-md bg-primary/10 px-1.5 text-[11px] font-medium text-primary">
                                            {item.count}
                                        </span>
                                    ) : null}
                                </button>
                            );
                        })}
                    </div>

                    {tab === "members" ? (
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
                            <section className={SECTION}>
                                <header className={SECTION_HEADER}>
                                    <h2 className={SECTION_TITLE}>People</h2>
                                    <span className="hidden text-xs text-muted-foreground sm:inline">
                                        {activeOrg?.name} · you are {activeOrg?.role}
                                    </span>
                                </header>
                                <ul className="divide-y divide-border text-sm" data-testid="organization-members">
                                    {members.map((member) => (
                                        <li
                                            key={member.id}
                                            className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                                            data-testid="organization-member-row"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <UserChip
                                                    user={
                                                        member.user ?? {
                                                            id: member.userId,
                                                            username: "Unknown user",
                                                        }
                                                    }
                                                    size={28}
                                                />
                                                {member.user?.email ? (
                                                    <p className="truncate pl-9 text-xs text-muted-foreground">
                                                        {member.user.email}
                                                    </p>
                                                ) : null}
                                            </div>
                                            <div className="flex shrink-0 items-center gap-2">
                                                {canManage && member.role !== "owner" ? (
                                                    <select
                                                        aria-label={`Role for ${member.user?.username ?? "member"}`}
                                                        data-testid="organization-member-role"
                                                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                                                        value={member.role}
                                                        disabled={roleMutation.isPending}
                                                        onChange={(event) =>
                                                            void handleChangeRole(member.userId, event.target.value)
                                                        }
                                                    >
                                                        <option value="member">member</option>
                                                        <option value="admin">admin</option>
                                                    </select>
                                                ) : (
                                                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                                                        {member.role}
                                                    </span>
                                                )}
                                                {canManage && member.role !== "owner" ? (
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-8 text-muted-foreground hover:text-destructive"
                                                        data-testid="organization-remove-member"
                                                        disabled={removeMemberMutation.isPending}
                                                        onClick={() => void handleRemoveMember(member.userId)}
                                                    >
                                                        Remove
                                                    </Button>
                                                ) : null}
                                            </div>
                                        </li>
                                    ))}
                                    {members.length === 0 ? (
                                        <li className="px-4 py-3 text-muted-foreground">No members yet.</li>
                                    ) : null}
                                </ul>
                                <footer className="border-t border-border px-4 py-2">
                                    {canLeave ? (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-8"
                                            data-testid="organization-leave"
                                            disabled={leaveMutation.isPending}
                                            onClick={() => void handleLeave()}
                                        >
                                            Leave organization
                                        </Button>
                                    ) : activeOrg?.role === "owner" ? (
                                        <p className="text-xs text-muted-foreground">
                                            Owners cannot leave without transferring ownership.
                                        </p>
                                    ) : null}
                                </footer>
                            </section>

                            <div className="space-y-4">
                                <section className={SECTION}>
                                    <header className={SECTION_HEADER}>
                                        <h2 className={SECTION_TITLE}>Invite by email</h2>
                                    </header>
                                    <div className="space-y-2 p-4">
                                        <Input
                                            className="h-8"
                                            placeholder="teammate@company.com"
                                            value={inviteEmail}
                                            onChange={(e) => setInviteEmail(e.target.value)}
                                            data-testid="organization-invite-email"
                                        />
                                        <div className="flex gap-2">
                                            <select
                                                aria-label="Invite role"
                                                data-testid="organization-invite-role"
                                                className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                                                value={inviteRole}
                                                onChange={(event) =>
                                                    setInviteRole(event.target.value as "member" | "admin")
                                                }
                                            >
                                                <option value="member">member</option>
                                                <option value="admin">admin</option>
                                            </select>
                                            <Button
                                                size="sm"
                                                className="h-8"
                                                onClick={() => void handleInvite()}
                                                disabled={!inviteEmail.trim() || inviteMutation.isPending || !canManage}
                                                data-testid="organization-invite"
                                            >
                                                Send invite
                                            </Button>
                                        </div>
                                    </div>
                                </section>

                                <section className={SECTION} data-testid="organization-pending-invites">
                                    <header className={SECTION_HEADER}>
                                        <h2 className={SECTION_TITLE}>Pending invitations</h2>
                                        <span className="text-xs text-muted-foreground">{pendingInvites.length}</span>
                                    </header>
                                    {pendingInvites.length === 0 ? (
                                        <p className="px-4 py-3 text-sm text-muted-foreground">No pending invites.</p>
                                    ) : (
                                        <ul className="divide-y divide-border text-sm">
                                            {pendingInvites.map((invite) => (
                                                <li
                                                    key={invite.id}
                                                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                                                >
                                                    <span className="min-w-0 truncate">
                                                        {invite.email}
                                                        <span className="text-xs text-muted-foreground"> · {invite.role}</span>
                                                    </span>
                                                    <div className="flex gap-1">
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="h-7 px-2 text-xs"
                                                            data-testid="organization-resend-invite"
                                                            disabled={resendMutation.isPending}
                                                            onClick={() => void handleResend(invite.id)}
                                                        >
                                                            Resend
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                                                            data-testid="organization-revoke-invite"
                                                            disabled={revokeMutation.isPending}
                                                            onClick={() => void handleRevoke(invite.id)}
                                                        >
                                                            Revoke
                                                        </Button>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                    {acceptedInvites.length > 0 ? (
                                        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                                            Recently joined:{" "}
                                            {acceptedInvites
                                                .slice(0, 5)
                                                .map((invite) => invite.email)
                                                .join(", ")}
                                        </p>
                                    ) : null}
                                </section>
                            </div>
                        </div>
                    ) : null}

                    {tab === "policy" ? (
                        <OrgPolicyQuotaPanel organizationId={activeOrgId} canManage={canManage} />
                    ) : null}
                    {tab === "usage" ? <OrgUsageGrantsPanel organizationId={activeOrgId} members={members} /> : null}
                </>
            ) : (
                <section className={cn(SECTION, "p-4 text-sm")}>
                    <p className="font-medium text-foreground">You are in your personal workspace</p>
                    <p className="mt-1 text-muted-foreground">
                        Create or pick an organization to invite teammates by email and manage execution policy.
                    </p>
                </section>
            )}
        </div>
    );
}

function csv(values: unknown): string {
    return Array.isArray(values) ? values.filter((value) => typeof value === "string").join(", ") : "";
}

function parseCsv(value: string): string[] {
    return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function OrgPolicyQuotaPanel({
    organizationId,
    canManage,
}: {
    organizationId: string;
    canManage: boolean;
}) {
    const [executionMode, setExecutionMode] = useState("suggest_only");
    const [effectiveMode, setEffectiveMode] = useState("suggest_only");
    const [confidenceThresholds, setConfidenceThresholds] = useState("");
    const [allowedDomains, setAllowedDomains] = useState("");
    const [requireApproval, setRequireApproval] = useState("send_email");
    const [toolDenyList, setToolDenyList] = useState("");
    const [defaultGrants, setDefaultGrants] = useState("");
    const [promptGuardMode, setPromptGuardMode] = useState("");
    const [maxTokens, setMaxTokens] = useState("");
    const [maxMembers, setMaxMembers] = useState("");
    const [message, setMessage] = useState<string | null>(null);

    const policyMutation = useUpdateOrganizationPolicy(organizationId);
    const quotaMutation = useUpdateOrganizationQuota(organizationId);

    useEffect(() => {
        let cancelled = false;
        void getOrganizationPolicy(organizationId)
            .then((policy) => {
                if (cancelled) return;
                const storedMode = typeof policy.executionMode === "string" ? policy.executionMode : "";
                const effective =
                    typeof policy.effectiveExecutionMode === "string"
                        ? policy.effectiveExecutionMode
                        : "suggest_only";
                setExecutionMode(storedMode || effective || "suggest_only");
                setEffectiveMode(effective || "suggest_only");
                const thresholds = policy.confidenceThresholds;
                setConfidenceThresholds(
                    thresholds && typeof thresholds === "object" && !Array.isArray(thresholds)
                        ? JSON.stringify(thresholds, null, 2)
                        : ""
                );
                setAllowedDomains(csv(policy.allowedEmailDomains));
                setRequireApproval(csv(policy.requireApprovalFor) || "send_email");
                setToolDenyList(csv(policy.toolDenyList));
                setDefaultGrants(csv(policy.defaultToolGrants));
                setPromptGuardMode(typeof policy.promptGuardMode === "string" ? policy.promptGuardMode : "");
            })
            .catch(() => {
                if (cancelled) return;
                setMessage("Could not load the current policy.");
            });
        return () => {
            cancelled = true;
        };
    }, [organizationId]);

    async function savePolicy() {
        setMessage(null);
        if (!canManage) {
            setMessage("Only an owner or admin can change organization policy.");
            return;
        }
        try {
            let thresholds: Record<string, number> | null = null;
            if (confidenceThresholds.trim()) {
                const parsed = JSON.parse(confidenceThresholds) as unknown;
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                    setMessage("Confidence thresholds must be a JSON object.");
                    return;
                }
                const next: Record<string, number> = {};
                for (const [key, value] of Object.entries(parsed)) {
                    if (typeof value !== "number" || !Number.isFinite(value)) {
                        setMessage(`Confidence threshold “${key}” must be a number.`);
                        return;
                    }
                    next[key] = value;
                }
                thresholds = next;
            }

            await policyMutation.mutateAsync({
                executionMode,
                confidenceThresholds: thresholds,
                allowedEmailDomains: parseCsv(allowedDomains),
                requireApprovalFor: parseCsv(requireApproval),
                toolDenyList: parseCsv(toolDenyList),
                defaultToolGrants: parseCsv(defaultGrants),
                promptGuardMode: promptGuardMode || null,
            });
            setEffectiveMode(executionMode);
            setMessage("Policy saved. The default execution mode is suggest_only unless you change it.");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "Failed to save policy");
        }
    }

    async function saveQuota() {
        setMessage(null);
        if (!canManage) {
            setMessage("Only an owner or admin can change quotas.");
            return;
        }
        try {
            let maxTokensPerMonth: number | null = null;
            let maxMembersValue: number | null = null;

            if (maxTokens.trim()) {
                const parsed = Number(maxTokens);
                if (!Number.isFinite(parsed)) {
                    setMessage("Max tokens must be a finite number.");
                    return;
                }
                maxTokensPerMonth = parsed;
            }

            if (maxMembers.trim()) {
                const parsed = Number(maxMembers);
                if (!Number.isFinite(parsed)) {
                    setMessage("Max members must be a finite number.");
                    return;
                }
                maxMembersValue = parsed;
            }

            await quotaMutation.mutateAsync({
                maxTokensPerMonth,
                maxMembers: maxMembersValue,
            });
            setMessage("Quota saved.");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "Failed to save quota");
        }
    }

    return (
        <div className="space-y-3" data-testid="organization-policy">
            {message ? <p className="text-sm text-foreground">{message}</p> : null}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
                <section className={SECTION}>
                    <header className={SECTION_HEADER}>
                        <h2 className={SECTION_TITLE}>Execution policy</h2>
                        <code className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-primary">
                            {effectiveMode}
                        </code>
                    </header>
                    <p className="px-4 pt-3 text-xs text-muted-foreground" data-testid="organization-execution-mode">
                        Effective execution mode: {effectiveMode}. Default is suggest_only.
                    </p>
                    <div className="grid gap-x-6 gap-y-3 p-4 md:grid-cols-2">
                        <div className="space-y-3">
                            <label className="block space-y-1">
                                <span className={FIELD_LABEL}>Execution mode</span>
                                <select
                                    className={SELECT}
                                    data-testid="organization-policy-execution-mode"
                                    value={executionMode}
                                    disabled={!canManage || policyMutation.isPending}
                                    onChange={(event) => setExecutionMode(event.target.value)}
                                >
                                    <option value="suggest_only">suggest_only</option>
                                    <option value="require_approval">require_approval</option>
                                    <option value="auto_execute">auto_execute</option>
                                </select>
                            </label>
                            <label className="block space-y-1">
                                <span className={FIELD_LABEL}>Prompt guard</span>
                                <select
                                    className={SELECT}
                                    data-testid="organization-policy-prompt-guard"
                                    value={promptGuardMode}
                                    disabled={!canManage}
                                    onChange={(event) => setPromptGuardMode(event.target.value)}
                                >
                                    <option value="">unset</option>
                                    <option value="off">off</option>
                                    <option value="monitor">monitor</option>
                                    <option value="enforce">enforce</option>
                                </select>
                            </label>
                            <label className="block space-y-1">
                                <span className={FIELD_LABEL}>Confidence thresholds (JSON object)</span>
                                <textarea
                                    className="min-h-20 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
                                    data-testid="organization-policy-thresholds"
                                    value={confidenceThresholds}
                                    disabled={!canManage}
                                    onChange={(event) => setConfidenceThresholds(event.target.value)}
                                    placeholder='{"task": 0.8}'
                                />
                            </label>
                        </div>
                        <div className="space-y-3">
                            <label className="block space-y-1">
                                <span className={FIELD_LABEL}>Require approval for tools</span>
                                <Input
                                    className="h-8"
                                    data-testid="organization-policy-require-approval"
                                    value={requireApproval}
                                    disabled={!canManage}
                                    onChange={(event) => setRequireApproval(event.target.value)}
                                />
                            </label>
                            <label className="block space-y-1">
                                <span className={FIELD_LABEL}>Tool deny list</span>
                                <Input
                                    className="h-8"
                                    data-testid="organization-policy-deny"
                                    value={toolDenyList}
                                    disabled={!canManage}
                                    onChange={(event) => setToolDenyList(event.target.value)}
                                    placeholder="send_email"
                                />
                            </label>
                            <label className="block space-y-1">
                                <span className={FIELD_LABEL}>Default tool grants</span>
                                <Input
                                    className="h-8"
                                    data-testid="organization-policy-grants"
                                    value={defaultGrants}
                                    disabled={!canManage}
                                    onChange={(event) => setDefaultGrants(event.target.value)}
                                />
                            </label>
                            <label className="block space-y-1">
                                <span className={FIELD_LABEL}>Allowed email domains</span>
                                <Input
                                    className="h-8"
                                    data-testid="organization-policy-domains"
                                    value={allowedDomains}
                                    disabled={!canManage}
                                    onChange={(event) => setAllowedDomains(event.target.value)}
                                    placeholder="example.com, acme.com"
                                />
                            </label>
                        </div>
                    </div>
                    <footer className="flex items-center justify-between gap-2 border-t border-border px-4 py-2">
                        <p className="text-[11px] text-muted-foreground">
                            Tools never run automatically unless the execution mode allows it.
                        </p>
                        <Button
                            size="sm"
                            className="h-8"
                            onClick={() => void savePolicy()}
                            disabled={!canManage || policyMutation.isPending}
                        >
                            Save policy
                        </Button>
                    </footer>
                </section>

                <section className={SECTION}>
                    <header className={SECTION_HEADER}>
                        <h2 className={SECTION_TITLE}>Quotas</h2>
                    </header>
                    <div className="space-y-2 p-4">
                        <Input
                            className="h-8"
                            placeholder="Max tokens / month"
                            value={maxTokens}
                            disabled={!canManage}
                            onChange={(e) => setMaxTokens(e.target.value)}
                        />
                        <Input
                            className="h-8"
                            placeholder="Max members"
                            value={maxMembers}
                            disabled={!canManage}
                            onChange={(e) => setMaxMembers(e.target.value)}
                        />
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-8 w-full"
                            onClick={() => void saveQuota()}
                            disabled={!canManage || quotaMutation.isPending}
                        >
                            Save quota
                        </Button>
                    </div>
                </section>
            </div>
        </div>
    );
}

function OrgUsageGrantsPanel({
    organizationId,
    members,
}: {
    organizationId: string;
    members: Array<{
        userId: string;
        role: string;
        user?: { id: string; username: string; email?: string };
    }>;
}) {
    const [tokens, setTokens] = useState<number | null>(null);
    const [grants, setGrants] = useState<
        Array<{ id: string; userId: string; toolName: string; grantedBy: string; createdAt: string }>
    >([]);

    useEffect(() => {
        let cancelled = false;
        void Promise.all([
            getOrganizationUsage(organizationId),
            listOrganizationToolGrants(organizationId),
        ])
            .then(([usage, grantData]) => {
                if (cancelled) return;
                setTokens(usage.tokensThisMonth);
                setGrants(grantData.grants);
            })
            .catch(() => {
                if (cancelled) return;
                setTokens(null);
                setGrants([]);
            });
        return () => {
            cancelled = true;
        };
    }, [organizationId]);

    const memberById = new Map(members.map((member) => [member.userId, member]));

    return (
        <div
            className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start"
            data-testid="organization-usage-grants"
        >
            <section className={cn(SECTION, "p-4")}>
                <h2 className="text-xs font-medium text-muted-foreground">Usage this month</h2>
                <p className="mt-1.5 text-2xl font-semibold leading-none text-foreground">
                    {tokens == null ? "—" : tokens.toLocaleString()}
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground" data-testid="organization-usage">
                    Tokens this month: {tokens == null ? "—" : tokens.toLocaleString()}
                </p>
            </section>
            <section className={SECTION}>
                <header className={SECTION_HEADER}>
                    <h2 className={SECTION_TITLE}>Tool permissions</h2>
                    <span className="text-xs text-muted-foreground">Person / Tool / Permission</span>
                </header>
                {grants.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-muted-foreground">No tool grants yet.</p>
                ) : (
                    <ul className="divide-y divide-border text-sm">
                        {grants.map((grant) => {
                            const member = memberById.get(grant.userId);
                            return (
                                <li key={grant.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2">
                                    <UserChip
                                        user={
                                            member?.user ?? {
                                                id: grant.userId,
                                                username: "Unknown user",
                                            }
                                        }
                                        size={20}
                                    />
                                    <code className="truncate font-mono text-xs text-foreground">{grant.toolName}</code>
                                    <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                                        allowed
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>
        </div>
    );
}
