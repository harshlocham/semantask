"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    addOrganizationMember,
    createOrganization,
    getOrganizationMembers,
    listOrganizations,
    updateOrganizationPolicy,
    updateOrganizationQuota,
    type ClientOrganization,
} from "@/lib/utils/api";

const STORAGE_KEY = "semantask.activeOrganizationId";

export default function OrganizationsPage() {
    const [orgs, setOrgs] = useState<ClientOrganization[]>([]);
    const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [memberUserId, setMemberUserId] = useState("");
    const [members, setMembers] = useState<Array<{ id: string; userId: string; role: string }>>([]);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function load() {
        setLoading(true);
        setError(null);
        try {
            const list = await listOrganizations();
            setOrgs(list);
            const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
            if (stored && list.some((org) => org.id === stored)) {
                setActiveOrgId(stored);
            }
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Failed to load organizations");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void load();
    }, []);

    useEffect(() => {
        if (!activeOrgId) {
            setMembers([]);
            return;
        }
        void getOrganizationMembers(activeOrgId)
            .then(setMembers)
            .catch((loadError) => {
                setError(loadError instanceof Error ? loadError.message : "Failed to load members");
            });
    }, [activeOrgId]);

    function selectOrg(id: string | null) {
        setActiveOrgId(id);
        if (typeof window !== "undefined") {
            if (id) {
                localStorage.setItem(STORAGE_KEY, id);
            } else {
                localStorage.removeItem(STORAGE_KEY);
            }
        }
        setStatus(id ? `Active organization set. API calls can send X-Organization-Id: ${id}` : "Personal workspace selected.");
    }

    async function handleCreate() {
        setError(null);
        setStatus(null);
        try {
            const org = await createOrganization({ name: name.trim(), slug: slug.trim() || undefined });
            setName("");
            setSlug("");
            setStatus(`Created ${org.name}`);
            await load();
            selectOrg(org.id);
        } catch (createError) {
            setError(createError instanceof Error ? createError.message : "Failed to create organization");
        }
    }

    async function handleAddMember() {
        if (!activeOrgId) return;
        setError(null);
        try {
            await addOrganizationMember(activeOrgId, { userId: memberUserId.trim() });
            setMemberUserId("");
            setStatus("Member added.");
            const next = await getOrganizationMembers(activeOrgId);
            setMembers(next);
        } catch (addError) {
            setError(addError instanceof Error ? addError.message : "Failed to add member");
        }
    }

    return (
        <div className="mx-auto max-w-3xl space-y-6 p-6">
            <Card>
                <CardHeader>
                    <CardTitle>Organizations</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Personal workspace is the default (no header). Select an organization to scope
                        conversations via <code>X-Organization-Id</code>.
                    </p>
                    {error ? <p className="text-sm text-red-600">{error}</p> : null}
                    {status ? <p className="text-sm text-green-700">{status}</p> : null}

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
                    <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
                    <Input placeholder="Slug (optional)" value={slug} onChange={(e) => setSlug(e.target.value)} />
                    <Button onClick={() => void handleCreate()} disabled={!name.trim()}>
                        Create
                    </Button>
                </CardContent>
            </Card>

            {activeOrgId ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Members</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <ul className="space-y-1 text-sm">
                            {members.map((member) => (
                                <li key={member.id}>
                                    {member.userId} — {member.role}
                                </li>
                            ))}
                        </ul>
                        <div className="flex gap-2">
                            <Input
                                placeholder="User ID"
                                value={memberUserId}
                                onChange={(e) => setMemberUserId(e.target.value)}
                            />
                            <Button onClick={() => void handleAddMember()} disabled={!memberUserId.trim()}>
                                Add member
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ) : null}

            {activeOrgId ? (
                <OrgPolicyQuotaPanel organizationId={activeOrgId} />
            ) : null}
        </div>
    );
}

function OrgPolicyQuotaPanel({ organizationId }: { organizationId: string }) {
    const [requireApproval, setRequireApproval] = useState("send_email");
    const [maxTokens, setMaxTokens] = useState("");
    const [maxMembers, setMaxMembers] = useState("");
    const [message, setMessage] = useState<string | null>(null);

    async function savePolicy() {
        setMessage(null);
        try {
            const tools = requireApproval
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean);
            await updateOrganizationPolicy(organizationId, {
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
            await updateOrganizationQuota(organizationId, {
                maxTokensPerMonth: maxTokens.trim() ? Number(maxTokens) : null,
                maxMembers: maxMembers.trim() ? Number(maxMembers) : null,
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
                        <Button onClick={() => void savePolicy()}>Save policy</Button>
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
                        <Button onClick={() => void saveQuota()}>Save quota</Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
