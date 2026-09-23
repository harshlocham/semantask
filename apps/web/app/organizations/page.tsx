"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { getOrganizationUsage, listOrganizationToolGrants } from "@/lib/utils/api";

export default function OrganizationsPage() {
    const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
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

    return (
        <div className="mx-auto max-w-3xl space-y-6 p-6" data-testid="organizations-page">
            <Card>
                <CardHeader>
                    <CardTitle>Organizations</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Create a workspace, invite teammates by email, and keep your active organization
                        selected for inbox and board.
                    </p>
                    {error ? <p className="text-sm text-red-600">{error}</p> : null}
                    {status ? <p className="text-sm text-green-700 break-all">{status}</p> : null}

                    <div className="flex flex-wrap gap-2">
                        <Button
                            variant={activeOrgId === null ? "default" : "outline"}
                            onClick={() => selectOrg(null)}
                        >
                            Personal
                        </Button>
                        {orgs.map((org) => (
                            <Button
                                key={org.id}
                                variant={activeOrgId === org.id ? "default" : "outline"}
                                onClick={() => selectOrg(org.id)}
                                data-testid="organization-option"
                            >
                                {org.name} ({org.role})
                            </Button>
                        ))}
                    </div>

                    {loading ? <p className="text-sm">Loading…</p> : null}

                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Create organization</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 sm:flex-row">
                    <Input
                        placeholder="Organization name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        data-testid="organization-name"
                    />
                    <Input
                        placeholder="Slug (optional)"
                        value={slug}
                        onChange={(e) => setSlug(e.target.value)}
                        data-testid="organization-slug"
                    />
                    <Button
                        onClick={() => void handleCreate()}
                        disabled={!name.trim() || createMutation.isPending}
                        data-testid="organization-create"
                    >
                        Create
                    </Button>
                </CardContent>
            </Card>

            {activeOrgId ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Team</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <p className="text-sm font-medium">People</p>
                            <ul className="space-y-2 text-sm" data-testid="organization-members">
                                {members.map((member) => (
                                    <li
                                        key={member.id}
                                        className="flex flex-wrap items-center gap-2"
                                        data-testid="organization-member-row"
                                    >
                                        <UserChip
                                            user={
                                                member.user ?? {
                                                    id: member.userId,
                                                    username: "Unknown user",
                                                }
                                            }
                                            showEmail
                                        />
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
                                            <span className="text-xs text-muted-foreground">{member.role}</span>
                                        )}
                                        {canManage && member.role !== "owner" ? (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                data-testid="organization-remove-member"
                                                disabled={removeMemberMutation.isPending}
                                                onClick={() => void handleRemoveMember(member.userId)}
                                            >
                                                Remove
                                            </Button>
                                        ) : null}
                                    </li>
                                ))}
                                {members.length === 0 ? (
                                    <li className="text-muted-foreground">No members yet.</li>
                                ) : null}
                            </ul>
                            {canLeave ? (
                                <Button
                                    size="sm"
                                    variant="outline"
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
                        </div>

                        <div className="space-y-2 border-t border-border pt-4">
                            <p className="text-sm font-medium">Invite by email</p>
                            <div className="flex flex-col gap-2 sm:flex-row">
                                <Input
                                    placeholder="teammate@company.com"
                                    value={inviteEmail}
                                    onChange={(e) => setInviteEmail(e.target.value)}
                                    data-testid="organization-invite-email"
                                />
                                <select
                                    aria-label="Invite role"
                                    data-testid="organization-invite-role"
                                    className="h-10 rounded-md border border-input bg-background px-2 text-sm"
                                    value={inviteRole}
                                    onChange={(event) =>
                                        setInviteRole(event.target.value as "member" | "admin")
                                    }
                                >
                                    <option value="member">member</option>
                                    <option value="admin">admin</option>
                                </select>
                                <Button
                                    onClick={() => void handleInvite()}
                                    disabled={!inviteEmail.trim() || inviteMutation.isPending || !canManage}
                                    data-testid="organization-invite"
                                >
                                    Send invite
                                </Button>
                            </div>
                        </div>

                        <div className="space-y-2" data-testid="organization-pending-invites">
                            <p className="text-sm font-medium">Pending invitations</p>
                            {pendingInvites.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No pending invites.</p>
                            ) : (
                                <ul className="space-y-2 text-sm">
                                    {pendingInvites.map((invite) => (
                                        <li
                                            key={invite.id}
                                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                                        >
                                            <span>
                                                {invite.email} · {invite.role}
                                            </span>
                                            <div className="flex gap-2">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    data-testid="organization-resend-invite"
                                                    disabled={resendMutation.isPending}
                                                    onClick={() => void handleResend(invite.id)}
                                                >
                                                    Resend
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
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
                                <p className="text-xs text-muted-foreground">
                                    Recently joined:{" "}
                                    {acceptedInvites
                                        .slice(0, 5)
                                        .map((invite) => invite.email)
                                        .join(", ")}
                                </p>
                            ) : null}
                        </div>
                    </CardContent>
                </Card>
            ) : null}

            {activeOrgId ? <OrgPolicyQuotaPanel organizationId={activeOrgId} /> : null}
            {activeOrgId ? <OrgUsageGrantsPanel organizationId={activeOrgId} members={members} /> : null}
        </div>
    );
}

function OrgPolicyQuotaPanel({ organizationId }: { organizationId: string }) {
    const [requireApproval, setRequireApproval] = useState("send_email");
    const [maxTokens, setMaxTokens] = useState("");
    const [maxMembers, setMaxMembers] = useState("");
    const [message, setMessage] = useState<string | null>(null);

    const policyMutation = useUpdateOrganizationPolicy(organizationId);
    const quotaMutation = useUpdateOrganizationQuota(organizationId);

    async function savePolicy() {
        setMessage(null);
        try {
            const tools = requireApproval
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean);
            await policyMutation.mutateAsync({
                requireApprovalFor: tools,
            });
            setMessage("Policy saved.");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "Failed to save policy");
        }
    }

    async function saveQuota() {
        setMessage(null);
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
        <Card>
            <CardHeader>
                <CardTitle>Policy &amp; quotas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {message ? <p className="text-sm">{message}</p> : null}
                <div className="space-y-2">
                    <p className="text-sm font-medium">Require approval for tools (comma-separated)</p>
                    <div className="flex gap-2">
                        <Input value={requireApproval} onChange={(e) => setRequireApproval(e.target.value)} />
                        <Button onClick={() => void savePolicy()} disabled={policyMutation.isPending}>
                            Save policy
                        </Button>
                    </div>
                </div>
                <div className="space-y-2">
                    <p className="text-sm font-medium">Quotas</p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                            placeholder="Max tokens / month"
                            value={maxTokens}
                            onChange={(e) => setMaxTokens(e.target.value)}
                        />
                        <Input
                            placeholder="Max members"
                            value={maxMembers}
                            onChange={(e) => setMaxMembers(e.target.value)}
                        />
                        <Button onClick={() => void saveQuota()} disabled={quotaMutation.isPending}>
                            Save quota
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
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
        <Card data-testid="organization-usage-grants">
            <CardHeader>
                <CardTitle>Usage &amp; tool permissions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <p className="text-sm" data-testid="organization-usage">
                    Tokens this month: {tokens == null ? "—" : tokens.toLocaleString()}
                </p>
                <div className="space-y-2">
                    <p className="text-sm font-medium">Person / Tool / Permission</p>
                    {grants.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No tool grants yet.</p>
                    ) : (
                        <ul className="space-y-2 text-sm">
                            {grants.map((grant) => {
                                const member = memberById.get(grant.userId);
                                return (
                                    <li
                                        key={grant.id}
                                        className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
                                    >
                                        <UserChip
                                            user={
                                                member?.user ?? {
                                                    id: grant.userId,
                                                    username: "Unknown user",
                                                }
                                            }
                                            size={20}
                                        />
                                        <span>{grant.toolName.replace(/_/g, " ")}</span>
                                        <span className="text-xs text-muted-foreground">allowed</span>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
