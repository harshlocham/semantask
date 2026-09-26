"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
    CalendarClock,
    Github,
    Mail,
    ShieldCheck,
    SlidersHorizontal,
    Wrench,
    type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type TaskApprovalRecord } from "@/lib/utils/api";
import { useActiveOrganization } from "@/lib/hooks/useActiveOrganization";
import {
    taskApprovalsErrorMessage,
    useDecideTaskApproval,
    useTaskApprovalsList,
} from "@/lib/queries/use-task-approvals";
import { conversationMessageHref, taskHref } from "@/lib/work-links";
import { cn } from "@/lib/utils/utils";

function formatTimestamp(iso: string) {
    const value = new Date(iso);
    if (Number.isNaN(value.getTime())) return "-";
    return value.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function asStringList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is string => typeof entry === "string");
    }
    if (typeof value === "string" && value.trim()) return [value];
    return [];
}

const PREVIEW_CLASS =
    "grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs";

function PreviewRow({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
    return (
        <>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={multiline ? "line-clamp-3 whitespace-pre-wrap break-words" : "truncate"}>{value}</dd>
        </>
    );
}

function ExecutionPreview({ item }: { item: TaskApprovalRecord }) {
    const params = item.parameters ?? {};
    const tool = item.toolName || item.actionType;
    if (tool === "send_email") {
        return (
            <dl className={PREVIEW_CLASS} data-testid="approval-email-preview">
                <PreviewRow label="To" value={asStringList(params.to).join(", ") || "Missing recipient"} />
                <PreviewRow label="Subject" value={typeof params.subject === "string" ? params.subject : "—"} />
                <PreviewRow label="Message" value={typeof params.body === "string" ? params.body : "—"} multiline />
            </dl>
        );
    }
    if (tool === "create_github_issue") {
        return (
            <dl className={PREVIEW_CLASS} data-testid="approval-github-preview">
                <PreviewRow label="Title" value={typeof params.title === "string" ? params.title : "—"} />
                <PreviewRow label="Body" value={typeof params.body === "string" ? params.body : "—"} multiline />
            </dl>
        );
    }
    if (tool === "schedule_meeting") {
        return (
            <dl className={PREVIEW_CLASS} data-testid="approval-meeting-preview">
                <PreviewRow label="Summary" value={typeof params.summary === "string" ? params.summary : "—"} />
                <PreviewRow label="Notes" value={typeof params.notes === "string" ? params.notes : "—"} multiline />
            </dl>
        );
    }
    return null;
}

const TOOL_DISPLAY: Record<string, { label: string; icon: LucideIcon }> = {
    send_email: { label: "Send email", icon: Mail },
    create_github_issue: { label: "Create GitHub issue", icon: Github },
    schedule_meeting: { label: "Schedule meeting", icon: CalendarClock },
};

function requesterLabel(actorType: TaskApprovalRecord["actorType"]) {
    if (actorType === "agent") return "AI";
    if (actorType === "user") return "A teammate";
    return "System";
}

function stateLabel(state: string | null) {
    if (!state || state === "approval_pending") return "Pending";
    return state.replace(/_/g, " ");
}

function getPolicySummary(item: TaskApprovalRecord) {
    const after = item.patch?.after as Record<string, unknown> | null;
    const policyDecision =
        after && typeof after.policyDecision === "object"
            ? (after.policyDecision as Record<string, unknown>)
            : null;

    if (!policyDecision) return "No policy details available.";

    const reasons = Array.isArray(policyDecision.reasons)
        ? policyDecision.reasons.filter((entry): entry is string => typeof entry === "string")
        : [];

    if (reasons.length === 0) return "Approval required by policy.";
    return reasons.join(" ");
}

export function InboxApprovalsView() {
    const { organizationId, canManageMembers, organizationScopeReady } = useActiveOrganization();
    const [conversationId, setConversationId] = useState("");
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [actingId, setActingId] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [commentsById, setCommentsById] = useState<Record<string, string>>({});
    const [paramsById, setParamsById] = useState<Record<string, string>>({});
    const editedCommentIdsRef = useRef<Record<string, true>>({});
    const editedParamIdsRef = useRef<Record<string, true>>({});

    const scopedConversation = conversationId.trim() || undefined;
    const waitingForScope = !organizationScopeReady && !scopedConversation;
    const hasOrgScope = Boolean(canManageMembers && organizationId);
    const hasScope = Boolean(scopedConversation || hasOrgScope);
    const filtersVisible = filtersOpen || !organizationId || Boolean(scopedConversation);

    const listQuery = useTaskApprovalsList({
        organizationId: hasOrgScope ? organizationId : null,
        conversationId: scopedConversation,
    });

    const decideMutation = useDecideTaskApproval();

    const approvals = listQuery.data ?? [];

    useEffect(() => {
        if (!listQuery.data) return;
        const approvalsData = listQuery.data;
        const liveIds = new Set(approvalsData.map((approval) => approval._id));

        setCommentsById((current) => {
            const next: Record<string, string> = {};
            for (const approval of approvalsData) {
                next[approval._id] =
                    editedCommentIdsRef.current[approval._id] && current[approval._id] !== undefined
                        ? current[approval._id]
                        : "";
            }
            return next;
        });
        setParamsById((current) => {
            const next: Record<string, string> = {};
            for (const approval of approvalsData) {
                next[approval._id] =
                    editedParamIdsRef.current[approval._id] && current[approval._id] !== undefined
                        ? current[approval._id]
                        : JSON.stringify(approval.parameters ?? {}, null, 2);
            }
            return next;
        });
        for (const id of Object.keys(editedCommentIdsRef.current)) {
            if (!liveIds.has(id)) delete editedCommentIdsRef.current[id];
        }
        for (const id of Object.keys(editedParamIdsRef.current)) {
            if (!liveIds.has(id)) delete editedParamIdsRef.current[id];
        }
    }, [listQuery.data]);

    const loading = waitingForScope
        || (hasScope && (listQuery.isLoading || listQuery.isFetching) && !listQuery.data);
    const scopeError = waitingForScope
        ? null
        : !hasScope && organizationId && !canManageMembers
            ? "Only owners and admins can review organization-wide tool approvals. Enter a conversation id to review one thread."
        : !hasScope
            ? "Select an active organization or enter a conversation id to load execution approvals."
            : null;
    const loadError = listQuery.error ? taskApprovalsErrorMessage(listQuery.error) : null;
    const listError = scopeError ?? loadError;

    async function decide(item: TaskApprovalRecord, decision: "approve" | "reject") {
        setActingId(item._id);
        setActionError(null);
        try {
            let parsedParameters: Record<string, unknown> | undefined;
            const parameterText = paramsById[item._id] ?? "";

            if (parameterText.trim().length > 0) {
                try {
                    const parsed = JSON.parse(parameterText) as unknown;
                    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                        setActionError("Parameters override must be a JSON object.");
                        return;
                    }
                    parsedParameters = parsed as Record<string, unknown>;
                } catch {
                    setActionError("Parameters override contains invalid JSON.");
                    return;
                }
            }

            await decideMutation.mutateAsync({
                taskActionId: item._id,
                decision,
                reviewerComment: commentsById[item._id] || undefined,
                parameters: parsedParameters,
            });
        } catch (decisionError) {
            setActionError(taskApprovalsErrorMessage(decisionError));
        } finally {
            setActingId(null);
        }
    }

    return (
        <div className="space-y-3" data-testid="inbox-approvals">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border">
                <p className="-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 border-primary px-3 text-[13px] font-medium text-foreground">
                    Pending
                    {listQuery.data ? (
                        <span className="rounded-md bg-primary/10 px-1.5 text-[11px] font-medium text-primary">
                            {approvals.length}
                        </span>
                    ) : null}
                </p>
                <div className="mb-1.5 flex items-center gap-1.5">
                    <Button
                        data-testid="inbox-approvals-refresh"
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-lg"
                        onClick={() => void listQuery.refetch()}
                        disabled={listQuery.isFetching || !hasScope}
                    >
                        {listQuery.isFetching ? "Loading…" : "Refresh"}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 rounded-lg"
                        aria-expanded={filtersVisible}
                        aria-controls="inbox-approvals-filters"
                        onClick={() => setFiltersOpen((open) => !open)}
                    >
                        <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
                        Filter
                    </Button>
                </div>
            </div>

            <div
                id="inbox-approvals-filters"
                className={cn("max-w-sm space-y-1", !filtersVisible && "hidden")}
            >
                <Label htmlFor="inbox-approvals-conversation" className="text-xs text-muted-foreground">Conversation</Label>
                <Input
                    id="inbox-approvals-conversation"
                    data-testid="inbox-approvals-conversation"
                    className="h-8 rounded-lg text-[13px]"
                    value={conversationId}
                    onChange={(event) => setConversationId(event.target.value)}
                    placeholder={organizationId ? "Optional conversation id" : "Required for personal"}
                />
            </div>

            {loading ? (
                <div className="space-y-2" data-testid="inbox-approvals-loading">
                    {[0, 1, 2].map((index) => (
                        <div
                            key={index}
                            className="h-28 animate-pulse rounded-xl border border-border bg-muted/40"
                        />
                    ))}
                </div>
            ) : null}

            {!loading && listError ? (
                <Card data-testid="inbox-approvals-error">
                    <CardContent className="space-y-2 py-3 text-sm">
                        <p className="font-medium">Unable to load approvals</p>
                        <p className="text-muted-foreground">{listError}</p>
                        {hasScope ? (
                            <Button
                                data-testid="inbox-approvals-retry"
                                variant="outline"
                                onClick={() => {
                                    setActionError(null);
                                    void listQuery.refetch();
                                }}
                            >
                                Retry
                            </Button>
                        ) : null}
                    </CardContent>
                </Card>
            ) : null}

            {!loading && !listError && approvals.length === 0 ? (
                <Card data-testid="inbox-approvals-empty">
                    <CardContent className="space-y-2 py-3 text-sm">
                        <p className="font-medium">No pending approvals</p>
                        <p className="text-muted-foreground">
                            When policy requires approval for a tool action, it will appear here.
                        </p>
                    </CardContent>
                </Card>
            ) : null}

            {!loading && !listError && approvals.length > 0 ? (
                <div className="space-y-2" data-testid="inbox-approvals-list">
                    {actionError ? (
                        <p
                            className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                            data-testid="inbox-approvals-action-error"
                        >
                            {actionError}
                        </p>
                    ) : null}
                    {approvals.map((item) => {
                        const toolId = item.toolName || item.actionType;
                        const display = TOOL_DISPLAY[toolId];
                        const ToolIcon = display?.icon ?? Wrench;
                        return (
                        <article
                            key={item._id}
                            className="rounded-xl border border-border bg-card p-3"
                            data-testid="inbox-approvals-row"
                        >
                            <div className="flex gap-3">
                                <span
                                    aria-hidden="true"
                                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground"
                                >
                                    <ToolIcon className="h-4 w-4" />
                                </span>
                                <div className="min-w-0 flex-1 space-y-2">
                                    <div className="space-y-0.5">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h2 className="text-sm font-semibold text-foreground">
                                                {display?.label ?? "Tool action"}
                                            </h2>
                                            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-muted-foreground">
                                                {toolId}
                                            </code>
                                            <span
                                                className="ml-auto rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium capitalize text-amber-700 dark:text-amber-300"
                                                data-testid="inbox-approvals-state"
                                            >
                                                {stateLabel(item.executionState)}
                                            </span>
                                        </div>
                                        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                                            <span>Task:</span>
                                            <Link
                                                href={taskHref(item.taskId)}
                                                className="font-medium text-foreground hover:underline"
                                                data-testid="inbox-approvals-task"
                                            >
                                                Open task
                                            </Link>
                                            <span aria-hidden="true">·</span>
                                            <Link
                                                href={conversationMessageHref(item.conversationId)}
                                                className="hover:text-foreground hover:underline"
                                            >
                                                Open conversation
                                            </Link>
                                        </p>
                                        <p className="text-xs text-muted-foreground" data-testid="approval-actor">
                                            Requested by {requesterLabel(item.actorType)} · {formatTimestamp(item.createdAt)}
                                        </p>
                                    </div>
                                    <p className="text-[13px] text-foreground/80">{item.summary || "No summary"}</p>
                                    <ExecutionPreview item={item} />
                                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                        <ShieldCheck aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                        <span data-testid="inbox-approvals-policy">{getPolicySummary(item)}</span>
                                    </p>
                                    <div>
                                        <Label htmlFor={`comment-${item._id}`} className="sr-only">Reviewer comment</Label>
                                        <Input
                                            id={`comment-${item._id}`}
                                            data-testid="inbox-approvals-comment"
                                            className="h-8 rounded-lg text-[13px]"
                                            value={commentsById[item._id] ?? ""}
                                            onChange={(event) => {
                                                const value = event.target.value;
                                                editedCommentIdsRef.current[item._id] = true;
                                                setCommentsById((current) => ({
                                                    ...current,
                                                    [item._id]: value,
                                                }));
                                            }}
                                            placeholder="Reviewer comment (optional)"
                                        />
                                    </div>
                                    <details className="space-y-1.5">
                                        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                                            Edit parameters
                                        </summary>
                                        <Label htmlFor={`params-${item._id}`} className="text-xs text-muted-foreground">
                                            Parameters override (JSON object)
                                        </Label>
                                        <textarea
                                            id={`params-${item._id}`}
                                            data-testid="inbox-approvals-params"
                                            className="min-h-[96px] w-full rounded-lg border border-input bg-background p-2 font-mono text-xs"
                                            value={paramsById[item._id] ?? "{}"}
                                            onChange={(event) => {
                                                const value = event.target.value;
                                                editedParamIdsRef.current[item._id] = true;
                                                setParamsById((current) => ({
                                                    ...current,
                                                    [item._id]: value,
                                                }));
                                            }}
                                        />
                                    </details>
                                    <div className="grid grid-cols-2 gap-2 pt-1">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-8 rounded-lg"
                                            data-testid="inbox-approvals-reject"
                                            onClick={() => void decide(item, "reject")}
                                            disabled={actingId === item._id}
                                        >
                                            Reject
                                        </Button>
                                        <Button
                                            size="sm"
                                            className="h-8 rounded-lg"
                                            data-testid="inbox-approvals-approve"
                                            onClick={() => void decide(item, "approve")}
                                            disabled={actingId === item._id}
                                        >
                                            Approve
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </article>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
