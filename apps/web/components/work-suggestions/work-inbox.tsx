"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
    isWorkSuggestionStatus,
    type WorkSuggestionRecord,
    type WorkSuggestionStatus,
} from "@semantask/types";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, FileText, SlidersHorizontal, UserRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import useWorkSuggestionStore from "@/store/work-suggestion-store";
import {
    WorkInboxTriage,
    type OrgMemberOption,
} from "@/components/work-suggestions/work-inbox-triage";
import { useUser } from "@/context/UserContext";
import { useActiveOrganization } from "@/lib/hooks/useActiveOrganization";
import { queryKeys } from "@/lib/queries/keys";
import { useOrganizationMembers } from "@/lib/queries/use-organizations";
import {
    WORK_INBOX_PAGE_LIMIT,
    mutationErrorMessage,
    useAcceptWorkSuggestion,
    useAssignWorkSuggestion,
    useDismissWorkSuggestion,
    useRequestTaskExecution,
    useWorkSuggestionsList,
} from "@/lib/queries/use-work-suggestions";
import { conversationMessageHref } from "@/lib/work-links";
import { PriorityBadge } from "@/components/work-suggestions/priority-badge";
import {
    suggestionConfidencePercent,
    suggestionOutcome,
    suggestionPolicyLabel,
    suggestionSignalLabels,
    suggestionToolLabel,
} from "@/lib/work-suggestions/trust";
import { getWorkSuggestion } from "@/lib/utils/api";
import { cn } from "@/lib/utils/utils";
import {
    DEEP_LINK_HIGHLIGHT_CLASS,
    inboxSuggestionElementId,
} from "@/lib/deep-link-highlight";
import { useDeepLinkScroll } from "@/hooks/useDeepLinkScroll";

const STATUS_OPTIONS: Array<{ value: "" | WorkSuggestionStatus; label: string }> = [
    { value: "proposed", label: "Needs review" },
    { value: "accepted", label: "Accepted" },
    { value: "dismissed", label: "Dismissed" },
    { value: "converted", label: "Converted" },
    { value: "", label: "All" },
];

const QUEUE_TABS: Array<{ value: WorkSuggestionStatus; label: string }> = [
    { value: "proposed", label: "Needs review" },
    { value: "converted", label: "Converted" },
    { value: "dismissed", label: "Dismissed" },
];

function queueLabel(value: WorkSuggestionStatus): string {
    return QUEUE_TABS.find((tab) => tab.value === value)?.label ?? value;
}

const EMPTY_INBOX_ITEMS: WorkSuggestionRecord[] = [];

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

function formatDay(iso: string) {
    const value = new Date(iso);
    if (Number.isNaN(value.getTime())) return "-";
    return value.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function summarize(text: string, max = 140) {
    const normalized = text.trim().replace(/\s+/g, " ");
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, max - 1)}…`;
}

function ownersForSuggestion(
    item: WorkSuggestionRecord,
    ownerById: Record<string, string[]>
): string[] {
    const overlay = ownerById[item._id];
    if (overlay !== undefined) return overlay;
    // Candidates are extraction hints, not the linked task's current owners.
    if (item.status === "proposed") {
        return item.candidates.assigneeCandidates ?? [];
    }
    return [];
}

export function WorkInboxView() {
    const { organizationId } = useActiveOrganization();
    const { user } = useUser();
    const currentUserId = user?._id ?? null;
    const searchParams = useSearchParams();
    const highlightedSuggestionId = searchParams.get("suggestion");
    const queryConversationId = searchParams.get("conversationId")?.trim() ?? "";
    const [conversationId, setConversationId] = useState(queryConversationId);
    const [status, setStatus] = useState<"" | WorkSuggestionStatus>("proposed");
    const [page, setPage] = useState(1);
    const [deepLinkResolved, setDeepLinkResolved] = useState(!highlightedSuggestionId);
    const [deepLinkOrganizationId, setDeepLinkOrganizationId] = useState<string | null | undefined>(
        undefined
    );
    const [ownerById, setOwnerById] = useState<Record<string, string[]>>({});
    const [actingId, setActingId] = useState<string | null>(null);
    const [actionErrorById, setActionErrorById] = useState<Record<string, string | null>>({});
    const [filtersOpen, setFiltersOpen] = useState(false);

    const queryClient = useQueryClient();
    const refreshConversation = useWorkSuggestionStore((state) => state.refreshConversation);

    useEffect(() => {
        if (queryConversationId) {
            setConversationId(queryConversationId);
            setPage(1);
        }
    }, [queryConversationId]);

    useEffect(() => {
        if (!highlightedSuggestionId) {
            setDeepLinkResolved(true);
            setDeepLinkOrganizationId(undefined);
            return;
        }

        let cancelled = false;
        setDeepLinkResolved(false);

        void (async () => {
            try {
                const suggestion = await getWorkSuggestion(highlightedSuggestionId);
                if (cancelled) return;
                setDeepLinkOrganizationId(suggestion.organizationId ?? null);
                if (!queryConversationId && suggestion.conversationId) {
                    setConversationId(suggestion.conversationId);
                }
                if (isWorkSuggestionStatus(suggestion.status)) {
                    setStatus(suggestion.status);
                }
                setPage(1);
            } catch {
                // Keep query/org scope and default filters when lookup fails.
            } finally {
                if (!cancelled) {
                    setDeepLinkResolved(true);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [highlightedSuggestionId, queryConversationId]);

    const scopedConversationId = conversationId.trim() || undefined;
    const resolvingDeepLink = Boolean(highlightedSuggestionId && !deepLinkResolved);
    const listOrganizationId = highlightedSuggestionId
        ? (deepLinkOrganizationId ?? undefined)
        : organizationId;
    const hasScope = Boolean(listOrganizationId || scopedConversationId || resolvingDeepLink);

    const listQuery = useWorkSuggestionsList({
        organizationId: listOrganizationId,
        conversationId: scopedConversationId,
        status,
        page,
        limit: WORK_INBOX_PAGE_LIMIT,
        enabled: deepLinkResolved,
    });

    const membersQuery = useOrganizationMembers(organizationId);
    const members: OrgMemberOption[] = useMemo(
        () =>
            (membersQuery.data ?? []).map((member) => ({
                userId: member.userId,
                role: member.role,
                user: member.user ?? {
                    id: member.userId,
                    username: "Unknown user",
                },
            })),
        [membersQuery.data]
    );
    const memberNameById = useMemo(
        () => new Map(members.map((member) => [member.userId, member.user.username ?? "Unknown user"])),
        [members]
    );
    const filtersVisible = filtersOpen
        || !organizationId
        || Boolean(conversationId.trim())
        || !QUEUE_TABS.some((tab) => tab.value === status);

    const acceptMutation = useAcceptWorkSuggestion(listQuery.listParams);
    const dismissMutation = useDismissWorkSuggestion(listQuery.listParams);
    const assignMutation = useAssignWorkSuggestion(listQuery.listParams);
    const requestExecutionMutation = useRequestTaskExecution();

    const items = listQuery.data?.items ?? EMPTY_INBOX_ITEMS;
    const queueGroups = useMemo(() => {
        const order: WorkSuggestionStatus[] = ["proposed", "converted", "dismissed", "accepted"];
        if (status) {
            return [{ key: status, label: queueLabel(status), rows: items }];
        }
        return order
            .map((value) => ({
                key: value,
                label: queueLabel(value),
                rows: items.filter((item) => item.status === value),
            }))
            .filter((group) => group.rows.length > 0);
    }, [items, status]);
    const pagination = listQuery.data?.pagination;
    const totalPages = pagination?.totalPages ?? 1;
    const loading = resolvingDeepLink || listQuery.isLoading || listQuery.isFetching;
    const error = listQuery.error
        ? mutationErrorMessage(listQuery.error, "Failed to load inbox")
        : null;
    const highlightedOnPage = Boolean(
        highlightedSuggestionId && items.some((item) => item._id === highlightedSuggestionId)
    );

    useEffect(() => {
        if (!highlightedSuggestionId || !deepLinkResolved || !listQuery.isSuccess) return;
        if (highlightedOnPage) return;
        if (page >= totalPages) return;
        setPage((current) => Math.min(totalPages, current + 1));
    }, [
        highlightedSuggestionId,
        deepLinkResolved,
        listQuery.isSuccess,
        highlightedOnPage,
        page,
        totalPages,
    ]);

    useDeepLinkScroll(
        highlightedSuggestionId ? inboxSuggestionElementId(highlightedSuggestionId) : null,
        highlightedOnPage
    );

    const setRowError = (id: string, message: string | null) => {
        setActionErrorById((current) => ({ ...current, [id]: message }));
    };

    async function handleAccept(item: WorkSuggestionRecord, assignees: string[]) {
        const previousOwners = ownerById[item._id];
        setActingId(item._id);
        setRowError(item._id, null);

        if (assignees.length > 0) {
            setOwnerById((current) => ({ ...current, [item._id]: assignees }));
        }

        try {
            const response = await acceptMutation.mutateAsync({
                item,
                assignees,
                statusFilter: status,
            });
            if (response.task.assignees?.length) {
                setOwnerById((current) => ({
                    ...current,
                    [item._id]: response.task.assignees,
                }));
            }
            void refreshConversation(item.conversationId);
        } catch (actionError) {
            setOwnerById((current) => {
                const next = { ...current };
                if (previousOwners === undefined) {
                    delete next[item._id];
                } else {
                    next[item._id] = previousOwners;
                }
                return next;
            });
            setRowError(item._id, mutationErrorMessage(actionError, "Accept failed"));
        } finally {
            setActingId(null);
        }
    }

    async function handleDismiss(item: WorkSuggestionRecord, reason: string) {
        setActingId(item._id);
        setRowError(item._id, null);

        try {
            await dismissMutation.mutateAsync({
                item,
                reason,
                statusFilter: status,
            });
            void refreshConversation(item.conversationId);
        } catch (actionError) {
            setRowError(item._id, mutationErrorMessage(actionError, "Dismiss failed"));
        } finally {
            setActingId(null);
        }
    }

    async function handleAllowAiTools(item: WorkSuggestionRecord) {
        if (!item.convertedTaskId) return;
        setActingId(item._id);
        setRowError(item._id, null);
        try {
            await requestExecutionMutation.mutateAsync({
                taskId: item.convertedTaskId,
                reason: "Manager requested AI tool execution from work inbox",
            });
            await queryClient.invalidateQueries({ queryKey: queryKeys.taskApprovals.all });
        } catch (actionError) {
            setRowError(item._id, mutationErrorMessage(actionError, "Allow AI tools failed"));
        } finally {
            setActingId(null);
        }
    }

    async function handleAssign(item: WorkSuggestionRecord, assignees: string[]) {
        const previousOwners = ownersForSuggestion(item, ownerById);
        setActingId(item._id);
        setRowError(item._id, null);
        setOwnerById((current) => ({ ...current, [item._id]: assignees }));

        try {
            const response = await assignMutation.mutateAsync({ item, assignees });
            setOwnerById((current) => ({
                ...current,
                [item._id]: response.task.assignees ?? assignees,
            }));
            void refreshConversation(item.conversationId);
        } catch (actionError) {
            setOwnerById((current) => ({ ...current, [item._id]: previousOwners }));
            setRowError(item._id, mutationErrorMessage(actionError, "Assign failed"));
        } finally {
            setActingId(null);
        }
    }

    return (
        <div className="space-y-3" data-testid="work-inbox">
            {!organizationId ? (
                <p className="text-xs text-muted-foreground" data-testid="work-inbox-scope">
                    Personal — select a conversation to load suggestions
                </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border">
                <div className="-mb-px flex flex-wrap" data-testid="work-inbox-queue" role="group" aria-label="Review queue">
                    {QUEUE_TABS.map((tab) => {
                        const active = status === tab.value;
                        return (
                            <button
                                key={tab.value}
                                type="button"
                                className={cn(
                                    "inline-flex h-9 items-center gap-1.5 border-b-2 px-3 text-[13px] font-medium transition-colors",
                                    active
                                        ? "border-primary text-foreground"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                                data-testid={`work-inbox-queue-${tab.value}`}
                                aria-pressed={active}
                                onClick={() => {
                                    setPage(1);
                                    setStatus(tab.value);
                                }}
                            >
                                {tab.label}
                                {active && pagination ? (
                                    <span className="rounded-md bg-primary/10 px-1.5 text-[11px] font-medium text-primary">
                                        {pagination.total}
                                    </span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mb-1.5 h-8 gap-1.5 rounded-lg"
                    aria-expanded={filtersVisible}
                    aria-controls="work-inbox-filters"
                    onClick={() => setFiltersOpen((open) => !open)}
                >
                    <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
                    Filter
                </Button>
            </div>

            <div
                id="work-inbox-filters"
                className={cn("grid gap-2 sm:grid-cols-[180px_minmax(0,320px)]", !filtersVisible && "hidden")}
            >
                <div className="space-y-1">
                    <Label htmlFor="inbox-status" className="text-xs text-muted-foreground">Status</Label>
                    <select
                        id="inbox-status"
                        data-testid="work-inbox-status"
                        className="flex h-8 w-full rounded-lg border border-input bg-background px-2 text-[13px]"
                        value={status}
                        onChange={(event) => {
                            setPage(1);
                            setStatus(event.target.value as "" | WorkSuggestionStatus);
                        }}
                    >
                        {STATUS_OPTIONS.map((option) => (
                            <option key={option.label} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="space-y-1">
                    <Label htmlFor="inbox-conversation" className="text-xs text-muted-foreground">Conversation</Label>
                    <Input
                        id="inbox-conversation"
                        data-testid="work-inbox-conversation"
                        className="h-8 rounded-lg text-[13px]"
                        value={conversationId}
                        onChange={(event) => {
                            setPage(1);
                            setConversationId(event.target.value);
                        }}
                        placeholder={organizationId ? "Optional conversation id" : "Required for personal"}
                    />
                </div>
            </div>

            {!hasScope ? (
                <Card data-testid="work-inbox-onboarding">
                    <CardContent className="space-y-3 py-3 text-sm">
                        <p className="font-medium">Choose a scope to load your inbox</p>
                        <p className="text-muted-foreground">
                            Set an active organization on the Organizations page, or enter a conversation
                            id above for personal workspace suggestions.
                        </p>
                        <Button asChild variant="outline">
                            <Link href="/organizations">Open organizations</Link>
                        </Button>
                    </CardContent>
                </Card>
            ) : null}

            {hasScope && loading && !listQuery.data && !error ? (
                <div className="space-y-3" data-testid="work-inbox-loading">
                    {[0, 1, 2].map((index) => (
                        <div
                            key={index}
                            className="h-24 animate-pulse rounded-md border border-border bg-muted/40"
                        />
                    ))}
                </div>
            ) : null}

            {hasScope && error ? (
                <Card data-testid="work-inbox-error">
                    <CardContent className="space-y-3 py-3 text-sm">
                        <p className="font-medium">Unable to load inbox</p>
                        <p className="text-muted-foreground">{error}</p>
                        <Button
                            data-testid="work-inbox-retry"
                            variant="outline"
                            onClick={() => void listQuery.refetch()}
                        >
                            Retry
                        </Button>
                    </CardContent>
                </Card>
            ) : null}

            {hasScope && listQuery.isSuccess && items.length === 0 ? (
                <Card data-testid="work-inbox-empty">
                    <CardContent className="space-y-2 py-3 text-sm">
                        <p className="font-medium">
                            {status === "proposed" || status === ""
                                ? "No proposed suggestions"
                                : `No ${status} suggestions`}
                        </p>
                        <p className="text-muted-foreground">
                            When chat extracts reviewable work, it will appear here for coordination.
                        </p>
                    </CardContent>
                </Card>
            ) : null}

            {hasScope && listQuery.isSuccess && items.length > 0 ? (
                <div className="space-y-4" data-testid="work-inbox-list">
                    {queueGroups.map((group) => (
                    <section key={group.key} className="space-y-2" data-testid={`work-inbox-group-${group.key}`}>
                    {status === "" ? (
                        <h2 className="text-xs font-medium text-muted-foreground">{group.label}</h2>
                    ) : null}
                    {group.rows.map((item) => {
                        const toolLabel = suggestionToolLabel(item);
                        const policyLabel = suggestionPolicyLabel(item);
                        const signals = suggestionSignalLabels(item);
                        const assigneeNames = (item.candidates.assigneeCandidates ?? [])
                            .map((id) => memberNameById.get(id) ?? (id === currentUserId ? "Me" : null))
                            .filter((name): name is string => Boolean(name));
                        const assigneeCount = item.candidates.assigneeCandidates?.length ?? 0;
                        const triage = item.status === "proposed" || item.status === "converted";
                        return (
                        <article
                            key={item._id}
                            id={inboxSuggestionElementId(item._id)}
                            data-testid="work-inbox-row"
                            data-highlighted={item._id === highlightedSuggestionId ? "true" : "false"}
                            className={cn(
                                "flex flex-col gap-3 rounded-xl border border-border bg-card p-3 lg:flex-row lg:items-start",
                                item._id === highlightedSuggestionId && DEEP_LINK_HIGHLIGHT_CLASS
                            )}
                        >
                            <div className="flex min-w-0 flex-1 gap-3">
                                <span
                                    aria-hidden="true"
                                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                >
                                    <FileText className="h-4 w-4" />
                                </span>
                                <div className="min-w-0 flex-1 space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Link
                                            href={`/work-suggestions/${item._id}`}
                                            className="truncate text-sm font-semibold text-foreground hover:underline"
                                            data-testid="work-inbox-row-link"
                                        >
                                            {item.title}
                                        </Link>
                                        {item.candidates.priorityCandidate ? (
                                            <PriorityBadge priority={item.candidates.priorityCandidate} />
                                        ) : null}
                                        {item.status !== "proposed" ? (
                                            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
                                                {item.status}
                                            </span>
                                        ) : null}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        From{" "}
                                        <Link
                                            href={conversationMessageHref(item.conversationId)}
                                            className="font-medium text-foreground hover:underline"
                                            data-testid="work-inbox-conversation-link"
                                        >
                                            {item.conversationLabel?.trim() || "Open conversation"}
                                        </Link>
                                        {" · "}
                                        {formatTimestamp(item.createdAt)}
                                    </p>
                                    <p className="line-clamp-2 text-[13px] text-foreground/80">
                                        {summarize(suggestionOutcome(item))}
                                    </p>
                                    <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5 text-xs text-muted-foreground">
                                        <div className="flex items-center gap-1">
                                            <dt><UserRound aria-hidden="true" className="h-3.5 w-3.5" /><span className="sr-only">Assignee</span></dt>
                                            <dd className="font-medium text-foreground">
                                                {assigneeNames.length > 0
                                                    ? assigneeNames.join(", ")
                                                    : assigneeCount > 0
                                                        ? `${assigneeCount} suggested`
                                                        : "Unassigned"}
                                            </dd>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <dt><CalendarDays aria-hidden="true" className="h-3.5 w-3.5" /><span className="sr-only">Due</span></dt>
                                            <dd className="font-medium text-foreground">
                                                {item.candidates.dueAtCandidate
                                                    ? `Due ${formatDay(item.candidates.dueAtCandidate)}`
                                                    : "No due date"}
                                            </dd>
                                        </div>
                                        <div className="flex items-center gap-1" data-testid="suggestion-confidence">
                                            <dt>Confidence</dt>
                                            <dd className="font-medium text-foreground">{suggestionConfidencePercent(item)}%</dd>
                                        </div>
                                        {signals.length > 0 ? (
                                            <div className="flex items-center gap-1" data-testid="suggestion-why">
                                                <dt className="sr-only">Why this suggestion?</dt>
                                                <dd>{signals.join(", ")}</dd>
                                            </div>
                                        ) : null}
                                        {toolLabel ? (
                                            <div className="flex items-center gap-1" data-testid="suggestion-tool">
                                                <dt>Suggested action</dt>
                                                <dd className="font-medium text-foreground">
                                                    {toolLabel}
                                                    {policyLabel ? (
                                                        <span className="font-normal text-muted-foreground" data-testid="suggestion-execution-policy">
                                                            {" "}({policyLabel})
                                                        </span>
                                                    ) : null}
                                                </dd>
                                            </div>
                                        ) : null}
                                    </dl>
                                    {item.possibleDuplicateTaskId ? (
                                        <p className="text-xs text-muted-foreground" data-testid="suggestion-duplicate-hint">
                                            Similar open work already exists in this conversation. Accept only if this is new.
                                        </p>
                                    ) : null}
                                </div>
                            </div>

                            {triage ? (
                                <div className="w-full shrink-0 lg:w-[340px]">
                                    <WorkInboxTriage
                                        suggestion={item}
                                        organizationId={organizationId}
                                        members={members}
                                        displayedOwners={ownersForSuggestion(item, ownerById)}
                                        currentUserId={currentUserId}
                                        actionPending={actingId === item._id}
                                        actionError={actionErrorById[item._id] ?? null}
                                        onAccept={(assignees) => handleAccept(item, assignees)}
                                        onAssign={(assignees) => handleAssign(item, assignees)}
                                        onDismiss={(reason) => handleDismiss(item, reason)}
                                        onAllowAiTools={() => handleAllowAiTools(item)}
                                    />
                                </div>
                            ) : item.dismissReason ? (
                                <p className="text-xs text-muted-foreground lg:w-[340px]">
                                    Dismissed: {item.dismissReason}
                                </p>
                            ) : null}
                        </article>
                        );
                    })}
                    </section>
                    ))}
                </div>
            ) : null}

            {hasScope && listQuery.isSuccess && pagination && totalPages > 1 ? (
                <div className="flex items-center justify-between gap-3" data-testid="work-inbox-pagination">
                    <Button
                        variant="outline"
                        disabled={page <= 1}
                        onClick={() => setPage((current) => Math.max(1, current - 1))}
                    >
                        Previous
                    </Button>
                    <p className="text-sm text-muted-foreground">
                        Page {pagination.page} of {totalPages} ({pagination.total} total)
                    </p>
                    <Button
                        variant="outline"
                        disabled={page >= totalPages}
                        onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    >
                        Next
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
