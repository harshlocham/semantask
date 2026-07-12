"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    createAdminToolGrant,
    getAdminToolGrants,
    revokeAdminToolGrant,
    seedAdminToolGrants,
    type AdminToolGrant,
} from "@/lib/utils/api";

const TOOLS = ["send_email", "schedule_meeting", "create_github_issue"] as const;
const PAGE_SIZE = 20;

function formatTimestamp(iso: string): string {
    const value = new Date(iso);
    if (Number.isNaN(value.getTime())) return "-";
    return value.toLocaleString();
}

export default function AdminToolGrantsPage() {
    const [grants, setGrants] = useState<AdminToolGrant[]>([]);
    const [userId, setUserId] = useState("");
    const [toolName, setToolName] = useState<string>("ALL");
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);

    const [grantUserId, setGrantUserId] = useState("");
    const [grantTool, setGrantTool] = useState<string>(TOOLS[0]);

    const filters = useMemo(
        () => ({
            page,
            limit: PAGE_SIZE,
            userId: userId.trim() || undefined,
            toolName: toolName === "ALL" ? undefined : toolName,
        }),
        [page, toolName, userId]
    );

    async function load() {
        setLoading(true);
        setError(null);
        try {
            const response = await getAdminToolGrants(filters);
            setGrants(response.grants);
            setTotalPages(response.pagination.totalPages);
            setTotal(response.pagination.total);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Failed to load tool grants");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters]);

    async function handleGrant() {
        setStatus(null);
        setError(null);
        try {
            await createAdminToolGrant({ userId: grantUserId.trim(), toolName: grantTool });
            setStatus("Grant created.");
            setGrantUserId("");
            await load();
        } catch (grantError) {
            setError(grantError instanceof Error ? grantError.message : "Failed to create grant");
        }
    }

    async function handleSeed() {
        setStatus(null);
        setError(null);
        try {
            const result = await seedAdminToolGrants();
            setStatus(`Seeded ${result.grantsCreated} grants across ${result.usersConsidered} users.`);
            await load();
        } catch (seedError) {
            setError(seedError instanceof Error ? seedError.message : "Failed to seed grants");
        }
    }

    async function handleRevoke(grantId: string) {
        if (!window.confirm("Revoke this tool grant? The user will lose access until re-granted.")) {
            return;
        }
        setStatus(null);
        setError(null);
        try {
            await revokeAdminToolGrant(grantId);
            setStatus("Grant revoked.");
            await load();
        } catch (revokeError) {
            setError(revokeError instanceof Error ? revokeError.message : "Failed to revoke grant");
        }
    }

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold">Tool Grants</h1>
            <p className="text-sm text-muted-foreground">
                High-risk tools (`send_email`, `schedule_meeting`, `create_github_issue`) require an active grant when
                `TASK_TOOL_RBAC=enforce`.
            </p>

            <Card>
                <CardHeader>
                    <CardTitle>Grant / Seed</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-4">
                    <label className="flex flex-col gap-1 text-sm">
                        User ID
                        <Input value={grantUserId} onChange={(e) => setGrantUserId(e.target.value)} placeholder="User ObjectId" />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                        Tool
                        <select
                            className="h-10 rounded-md border border-input bg-background px-3"
                            value={grantTool}
                            onChange={(e) => setGrantTool(e.target.value)}
                        >
                            {TOOLS.map((tool) => (
                                <option key={tool} value={tool}>
                                    {tool}
                                </option>
                            ))}
                        </select>
                    </label>
                    <div className="flex items-end gap-2">
                        <Button onClick={() => void handleGrant()} disabled={!grantUserId.trim()}>
                            Grant
                        </Button>
                        <Button variant="outline" onClick={() => void handleSeed()}>
                            Seed existing users
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Filters</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-3">
                    <label className="flex flex-col gap-1 text-sm">
                        User ID
                        <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Filter by user ID" />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                        Tool
                        <select
                            className="h-10 rounded-md border border-input bg-background px-3"
                            value={toolName}
                            onChange={(e) => {
                                setToolName(e.target.value);
                                setPage(1);
                            }}
                        >
                            <option value="ALL">All tools</option>
                            {TOOLS.map((tool) => (
                                <option key={tool} value={tool}>
                                    {tool}
                                </option>
                            ))}
                        </select>
                    </label>
                    <div className="flex items-end">
                        <Button variant="outline" onClick={() => { setUserId(""); setToolName("ALL"); setPage(1); }}>
                            Clear
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Active Grants ({total})</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                    {error ? <p className="text-sm text-red-500">{error}</p> : null}
                    {status ? <p className="mb-2 text-sm text-green-600">{status}</p> : null}

                    <table className="w-full border-collapse text-sm">
                        <thead>
                            <tr className="border-b text-left">
                                <th className="p-2">Tool</th>
                                <th className="p-2">User ID</th>
                                <th className="p-2">Conversation</th>
                                <th className="p-2">Granted By</th>
                                <th className="p-2">Created</th>
                                <th className="p-2">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td className="p-3" colSpan={6}>Loading...</td>
                                </tr>
                            ) : grants.length === 0 ? (
                                <tr>
                                    <td className="p-3" colSpan={6}>No grants found.</td>
                                </tr>
                            ) : (
                                grants.map((grant) => (
                                    <tr key={grant.id} className="border-b">
                                        <td className="p-2 font-medium">{grant.toolName}</td>
                                        <td className="p-2">{grant.userId}</td>
                                        <td className="p-2">{grant.conversationId || "global"}</td>
                                        <td className="p-2">{grant.grantedBy}</td>
                                        <td className="p-2">{formatTimestamp(grant.createdAt)}</td>
                                        <td className="p-2">
                                            <Button variant="outline" size="sm" onClick={() => void handleRevoke(grant.id)}>
                                                Revoke
                                            </Button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>

                    <div className="mt-4 flex items-center justify-end gap-2">
                        <Button variant="outline" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page <= 1 || loading}>
                            Previous
                        </Button>
                        <span className="text-sm">Page {page} of {totalPages}</span>
                        <Button variant="outline" onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={page >= totalPages || loading}>
                            Next
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
