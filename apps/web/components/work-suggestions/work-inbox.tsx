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
import { APP_HOME } from "@/lib/routes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { SuggestionTrustPanel } from "@/components/work-suggestions/suggestion-trust";
import { suggestionOutcome } from "@/lib/work-suggestions/trust";
import { getWorkSuggestion } from "@/lib/utils/api";
import {
    DEEP_LINK_HIGHLIGHT_CLASS,
    inboxSuggestionElementId,
} from "@/lib/deep-link-highlight";
import { useDeepLinkScroll } from "@/hooks/useDeepLinkScroll";

const STATUS_OPTIONS: Array<{ value: "" | WorkSuggestionStatus; label: string }> = [
    { value: "proposed", label: "proposed" },
    { value: "accepted", label: "accepted" },
    { value: "dismissed", label: "dismissed" },
    { value: "converted", label: "converted" },
    { value: "", label: "all" },
];

function formatTimestamp(iso: string) {
    const value = new Date(iso);
    if (Number.isNaN(value.getTime())) return "-";
    return value.toLocaleString();
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
    const { organizationId, organization } = useActiveOrganization();
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

    const acceptMutation = useAcceptWorkSuggestion(listQuery.listParams);
    const dismissMutation = useDismissWorkSuggestion(listQuery.listParams);
    const assignMutation = useAssignWorkSuggestion(listQuery.listParams);
    const requestExecutionMutation = useRequestTaskExecution();

    const items = listQuery.data?.items ?? [];
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
        <div className="space-y-6" data-testid="work-inbox">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold">Work inbox</h1>
                    <p className="text-sm text-muted-foreground">
                        Triage reviewable work suggestions without opening the orchestration panel.
                        Accept creates coordination work only — it never starts autonomous tool
                        execution.
                    </p>
                </div>
                <Button asChild variant="outline">
                    <Link href={APP_HOME}>Back to chat</Link>
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Scope and filters</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div
                        className="rounded-md border border-border px-3 py-2 text-sm"
                        data-testid="work-inbox-scope"
                    >
                        {organizationId ? (
                            <>
                                <span className="text-muted-foreground">Organization </span>
                                <span className="font-medium" data-testid="work-inbox-org-name">
                                    {organization?.name ?? "Organization"}
                                </span>
                            </>
                        ) : (
                            <span className="text-muted-foreground">
                                Personal — select a conversation to load suggestions
                            </span>
                        )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="inbox-status">Status</Label>
                            <select
                                id="inbox-status"
                                data-testid="work-inbox-status"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
                        <div className="space-y-2">
                            <Label htmlFor="inbox-conversation">Conversation</Label>
                            <Input
                                id="inbox-conversation"
                                data-testid="work-inbox-conversation"
                                value={conversationId}
                                onChange={(event) => {
                                    setPage(1);
                                    setConversationId(event.target.value);
                                }}
                                placeholder={organizationId ? "Optional filter" : "Required for personal"}
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {!hasScope ? (
                <Card data-testid="work-inbox-onboarding">
                    <CardContent className="space-y-3 p-6 text-sm">
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
                    <CardContent className="space-y-3 p-6 text-sm">
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
                    <CardContent className="space-y-2 p-6 text-sm">
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
                <div className="space-y-3" data-testid="work-inbox-list">
                    {items.map((item) => (
                        <Card
                            key={item._id}
                            id={inboxSuggestionElementId(item._id)}
                            data-testid="work-inbox-row"
                            data-highlighted={item._id === highlightedSuggestionId ? "true" : "false"}
                            className={item._id === highlightedSuggestionId ? DEEP_LINK_HIGHLIGHT_CLASS : undefined}
                        >
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">
                                    <Link
                                        href={`/work-suggestions/${item._id}`}
                                        className="hover:underline"
                                        data-testid="work-inbox-row-link"
                                    >
                                        {item.title}
                                    </Link>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2 text-sm">
                                <p className="text-muted-foreground">
                                    {summarize(suggestionOutcome(item))}
                                </p>
                                <SuggestionTrustPanel suggestion={item} />
                                <dl className="grid gap-2 sm:grid-cols-3">
                                    <div>
                                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                                            Status
                                        </dt>
                                        <dd className="font-medium capitalize">{item.status}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                                            Created
                                        </dt>
                                        <dd className="font-medium">{formatTimestamp(item.createdAt)}</dd>
                                    </div>
                                    <div className="sm:col-span-3">
                                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                                            Conversation
                                        </dt>
                                        <dd className="break-words">
                                            <Link
                                                href={conversationMessageHref(item.conversationId)}
                                                className="font-medium underline underline-offset-2 hover:opacity-80"
                                                data-testid="work-inbox-conversation-link"
                                            >
                                                {item.conversationLabel?.trim() || "Open conversation"}
                                            </Link>
                                        </dd>
                                    </div>
                                </dl>

                                {(item.status === "proposed" || item.status === "converted") ? (
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
                                ) : null}
                            </CardContent>
                        </Card>
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
