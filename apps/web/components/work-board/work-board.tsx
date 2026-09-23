"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BOARD_STATUSES, type BoardStatus, type TaskRecord } from "@semantask/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActiveOrganization } from "@/lib/hooks/useActiveOrganization";
import {
    mutationErrorMessage,
    useMoveWorkBoardCard,
    useWorkBoardList,
    WORK_BOARD_PAGE_LIMIT,
} from "@/lib/queries/use-work-board";
import { UserChip } from "@/components/people/user-chip";
import { conversationMessageHref, taskHref } from "@/lib/work-links";
import { getTask } from "@/lib/utils/api";
import { reviewSuggestionHref } from "@/lib/work-suggestions/map";
import {
    boardTaskElementId,
    DEEP_LINK_HIGHLIGHT_CLASS,
} from "@/lib/deep-link-highlight";
import { useDeepLinkScroll } from "@/hooks/useDeepLinkScroll";

const COLUMN_LABELS: Record<BoardStatus, string> = {
    todo: "Todo",
    doing: "Doing",
    done: "Done",
};

function runStateLabel(status: string) {
    const labels: Record<string, string> = {
        pending: "Pending",
        executing: "Executing",
        completed: "Completed",
        failed: "Failed",
        partial: "Partial",
        waiting_for_input: "Waiting for input",
    };
    return labels[status] ?? status;
}

function formatDue(iso: string | null) {
    if (!iso) return "No due date";
    const value = new Date(iso);
    if (Number.isNaN(value.getTime())) return "No due date";
    return value.toLocaleDateString();
}

function groupByBoardStatus(items: TaskRecord[]): Record<BoardStatus, TaskRecord[]> {
    const grouped: Record<BoardStatus, TaskRecord[]> = {
        todo: [],
        doing: [],
        done: [],
    };
    for (const item of items) {
        grouped[item.boardStatus].push(item);
    }
    return grouped;
}

export function WorkBoardView() {
    const { organizationId, organization } = useActiveOrganization();
    const searchParams = useSearchParams();
    const highlightedTaskId = searchParams.get("task");
    const queryConversationId = searchParams.get("conversationId")?.trim() ?? "";
    const [conversationId, setConversationId] = useState(queryConversationId);
    const [page, setPage] = useState(1);
    const [dueFilter, setDueFilter] = useState<"all" | "overdue" | "none">("all");
    const [priorityFilter, setPriorityFilter] = useState("");
    const [deepLinkResolved, setDeepLinkResolved] = useState(!highlightedTaskId);

    useEffect(() => {
        setConversationId(queryConversationId);
        setPage(1);
    }, [queryConversationId]);

    useEffect(() => {
        if (!highlightedTaskId) {
            setDeepLinkResolved(true);
            return;
        }

        let cancelled = false;
        setDeepLinkResolved(false);

        void (async () => {
            try {
                const task = await getTask(highlightedTaskId);
                if (cancelled) return;
                if (!queryConversationId && task.conversationId) {
                    setConversationId(task.conversationId);
                }
                setPage(1);
            } catch {
                // Keep query/org scope when lookup fails.
            } finally {
                if (!cancelled) {
                    setDeepLinkResolved(true);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [highlightedTaskId, queryConversationId]);

    const scopedConversationId = conversationId.trim() || undefined;
    const resolvingDeepLink = Boolean(highlightedTaskId && !deepLinkResolved);
    const hasScope = Boolean(organizationId || scopedConversationId || resolvingDeepLink);

    const listQuery = useWorkBoardList({
        organizationId,
        conversationId: scopedConversationId,
        page,
        limit: WORK_BOARD_PAGE_LIMIT,
        priority: priorityFilter || undefined,
        due: dueFilter,
        enabled: deepLinkResolved,
    });
    const moveMutation = useMoveWorkBoardCard(listQuery.listParams);

    const items = listQuery.data?.items ?? [];
    const pagination = listQuery.data?.pagination;
    const totalPages = pagination?.totalPages ?? 1;
    const columns = useMemo(() => groupByBoardStatus(items), [items]);
    const loading = resolvingDeepLink || listQuery.isLoading || listQuery.isFetching;
    const error = listQuery.error
        ? mutationErrorMessage(listQuery.error, "Failed to load board")
        : null;
    const highlightedOnPage = Boolean(
        highlightedTaskId && items.some((item) => item._id === highlightedTaskId)
    );

    useEffect(() => {
        if (!highlightedTaskId || !deepLinkResolved || !listQuery.isSuccess) return;
        if (highlightedOnPage) return;
        if (page >= totalPages) return;
        setPage((current) => Math.min(totalPages, current + 1));
    }, [
        highlightedTaskId,
        deepLinkResolved,
        listQuery.isSuccess,
        highlightedOnPage,
        page,
        totalPages,
    ]);

    useDeepLinkScroll(
        highlightedTaskId ? boardTaskElementId(highlightedTaskId) : null,
        highlightedOnPage
    );

    async function handleMove(task: TaskRecord, boardStatus: BoardStatus) {
        if (task.boardStatus === boardStatus) return;
        try {
            await moveMutation.mutateAsync({ task, boardStatus });
        } catch {
            // Row-level error is surfaced via mutation; list rolls back on error.
        }
    }

    return (
        <div className="space-y-6" data-testid="work-board">
            <Card>
                <CardHeader>
                    <CardTitle>Work board</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Track extracted work by coordination column. Run status stays on the
                        conversation panel — moving a card here does not start AI tools.
                    </p>
                    <div
                        className="rounded-md border border-dashed border-border px-3 py-2 text-sm"
                        data-testid="work-board-scope"
                    >
                        {organizationId ? (
                            <>
                                <span className="text-muted-foreground">Organization </span>
                                <span className="font-medium" data-testid="work-board-org-name">
                                    {organization?.name ?? "Organization"}
                                </span>
                            </>
                        ) : (
                            <span className="text-muted-foreground">
                                Personal — select a conversation to load the board
                            </span>
                        )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="space-y-2">
                            <Label htmlFor="board-conversation">Conversation</Label>
                            <Input
                                id="board-conversation"
                                data-testid="work-board-conversation"
                                value={conversationId}
                                onChange={(event) => {
                                    setPage(1);
                                    setConversationId(event.target.value);
                                }}
                                placeholder={organizationId ? "Optional filter" : "Required for personal"}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="board-due">Due</Label>
                            <select
                                id="board-due"
                                data-testid="work-board-due-filter"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                value={dueFilter}
                                onChange={(event) => {
                                    setPage(1);
                                    setDueFilter(event.target.value as typeof dueFilter);
                                }}
                            >
                                <option value="all">All</option>
                                <option value="overdue">Overdue</option>
                                <option value="none">No due date</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="board-priority">Priority</Label>
                            <select
                                id="board-priority"
                                data-testid="work-board-priority-filter"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                value={priorityFilter}
                                onChange={(event) => {
                                    setPage(1);
                                    setPriorityFilter(event.target.value);
                                }}
                            >
                                <option value="">All</option>
                                <option value="low">low</option>
                                <option value="medium">medium</option>
                                <option value="high">high</option>
                                <option value="urgent">urgent</option>
                            </select>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {!hasScope ? (
                <Card data-testid="work-board-onboarding">
                    <CardContent className="space-y-3 p-6 text-sm">
                        <p className="font-medium">Choose a scope to load the board</p>
                        <p className="text-muted-foreground">
                            Set an active organization, or enter a conversation id for personal work.
                        </p>
                        <Button asChild variant="outline">
                            <Link href="/organizations">Open organizations</Link>
                        </Button>
                    </CardContent>
                </Card>
            ) : null}

            {hasScope && loading && !listQuery.data && !error ? (
                <div className="grid gap-4 md:grid-cols-3" data-testid="work-board-loading">
                    {[0, 1, 2].map((index) => (
                        <div
                            key={index}
                            className="h-40 animate-pulse rounded-md border border-border bg-muted/40"
                        />
                    ))}
                </div>
            ) : null}

            {hasScope && error ? (
                <Card data-testid="work-board-error">
                    <CardContent className="space-y-3 p-6 text-sm">
                        <p className="font-medium">Unable to load board</p>
                        <p className="text-muted-foreground">{error}</p>
                        <Button
                            data-testid="work-board-retry"
                            variant="outline"
                            onClick={() => void listQuery.refetch()}
                        >
                            Retry
                        </Button>
                    </CardContent>
                </Card>
            ) : null}

            {hasScope && listQuery.isSuccess && items.length === 0 ? (
                <Card data-testid="work-board-empty">
                    <CardContent className="space-y-2 p-6 text-sm">
                        <p className="font-medium">No coordination work yet</p>
                        <p className="text-muted-foreground">
                            Accept a suggestion from the inbox to create a task on this board.
                        </p>
                    </CardContent>
                </Card>
            ) : null}

            {hasScope && listQuery.isSuccess && items.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-3" data-testid="work-board-columns">
                    {BOARD_STATUSES.map((column) => (
                        <section
                            key={column}
                            className="space-y-3"
                            data-testid={`work-board-column-${column}`}
                        >
                            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                                {COLUMN_LABELS[column]} ({columns[column].length})
                            </h2>
                            {columns[column].map((task) => (
                                <Card
                                    key={task._id}
                                    id={boardTaskElementId(task._id)}
                                    data-testid="work-board-card"
                                    data-highlighted={task._id === highlightedTaskId ? "true" : "false"}
                                    className={task._id === highlightedTaskId ? DEEP_LINK_HIGHLIGHT_CLASS : undefined}
                                >
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-base">
                                            <Link
                                                href={taskHref(task._id)}
                                                className="hover:underline"
                                                data-testid="work-board-card-title"
                                            >
                                                {task.title}
                                            </Link>
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-3 text-sm">
                                        <dl className="grid gap-2">
                                            <div>
                                                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                                                    Board
                                                </dt>
                                                <dd className="font-medium">{COLUMN_LABELS[task.boardStatus]}</dd>
                                            </div>
                                            <div>
                                                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                                                    Run
                                                </dt>
                                                <dd className="font-medium" data-testid="work-board-run-state">
                                                    {runStateLabel(task.status)}
                                                </dd>
                                            </div>
                                            <div>
                                                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                                                    Priority
                                                </dt>
                                                <dd className="font-medium capitalize">{task.priority}</dd>
                                            </div>
                                            <div>
                                                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                                                    Due
                                                </dt>
                                                <dd className="font-medium">{formatDue(task.dueAt)}</dd>
                                            </div>
                                            <div>
                                                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                                                    Assignees
                                                </dt>
                                                <dd className="font-medium">
                                                    {(task.assigneeRefs ?? []).length > 0 ? (
                                                        <div className="flex flex-wrap gap-2 pt-1">
                                                            {(task.assigneeRefs ?? []).map((user) => (
                                                                <UserChip key={user.id} user={user} size={20} />
                                                            ))}
                                                        </div>
                                                    ) : task.assignees.length > 0 ? (
                                                        `${task.assignees.length} assigned`
                                                    ) : (
                                                        "Unassigned"
                                                    )}
                                                </dd>
                                            </div>
                                        </dl>
                                        <div className="flex flex-wrap gap-3 text-xs">
                                            <Link
                                                href={conversationMessageHref(task.conversationId)}
                                                className="underline underline-offset-2 hover:opacity-80"
                                                data-testid="work-board-conversation-link"
                                            >
                                                {task.conversationLabel?.trim() || "Conversation"}
                                            </Link>
                                            {task.suggestionId ? (
                                                <Link
                                                    href={reviewSuggestionHref(task.suggestionId) ?? "#"}
                                                    className="underline underline-offset-2 hover:opacity-80"
                                                    data-testid="work-board-suggestion-link"
                                                >
                                                    Suggestion
                                                </Link>
                                            ) : null}
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {BOARD_STATUSES.filter((status) => status !== task.boardStatus).map(
                                                (status) => (
                                                    <Button
                                                        key={status}
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        data-testid={`work-board-move-${status}`}
                                                        disabled={moveMutation.isPending}
                                                        onClick={() => void handleMove(task, status)}
                                                    >
                                                        Move to {COLUMN_LABELS[status]}
                                                    </Button>
                                                )
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </section>
                    ))}
                </div>
            ) : null}

            {hasScope && listQuery.isSuccess && pagination && totalPages > 1 ? (
                <div className="flex items-center justify-between gap-3" data-testid="work-board-pagination">
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
