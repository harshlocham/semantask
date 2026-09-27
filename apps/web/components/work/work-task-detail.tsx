"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageSquareText } from "lucide-react";
import type { TaskActionRecord, TaskRecord } from "@semantask/types";
import { Button } from "@/components/ui/button";
import { UserChip } from "@/components/people/user-chip";
import { PriorityBadge } from "@/components/work-suggestions/priority-badge";
import { boardTaskHref, conversationMessageHref } from "@/lib/work-links";
import { ApiHttpError, authenticatedFetch, getTask, requestTaskExecutionApi } from "@/lib/utils/api";
import { cn } from "@/lib/utils/utils";

const BOARD_ORDER = ["todo", "doing", "done"] as const;

const BOARD_LABELS: Record<string, string> = {
    todo: "Todo",
    doing: "Doing",
    done: "Done",
};

const SOURCE_LABELS: Record<string, string> = {
    ai: "From chat",
    manual: "Manual",
    imported: "Imported",
};

const RAIL_SECTION = "rounded-xl border border-border bg-card p-3";
const RAIL_HEADING = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const FIELD_LABEL = "text-xs text-muted-foreground";

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

function coordinationLabel(status: string) {
    const text = status.toLowerCase().replace(/_/g, " ");
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatTimestamp(iso: string | null | undefined) {
    if (!iso) return "—";
    const value = new Date(iso);
    if (Number.isNaN(value.getTime())) return "—";
    return value.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDue(iso: string | null | undefined) {
    if (!iso) return "No due date";
    const value = new Date(iso);
    if (Number.isNaN(value.getTime())) return "No due date";
    return value.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function actionLabel(action: TaskActionRecord): string {
    if (action.executionState === "approval_pending") return "Approval requested";
    if (action.executionState === "approved") return "Approved";
    if (action.executionState === "running" || action.executionState === "queued") return "Running";
    if (action.executionState === "succeeded") return "Completed";
    if (action.executionState === "failed") return "Failed";
    if (action.executionState === "rejected") return "Rejected";
    if (action.actionType === "created") return "Accepted";
    if (action.actionType === "reassigned") return "Assigned";
    return action.summary || action.actionType.replace(/_/g, " ");
}

export function WorkTaskDetailView({ taskId }: { taskId: string }) {
    const [task, setTask] = useState<TaskRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [errorStatus, setErrorStatus] = useState<number | null>(null);
    const [acting, setActing] = useState(false);

    async function load() {
        setLoading(true);
        setError(null);
        setErrorStatus(null);
        try {
            const next = await getTask(taskId);
            setTask(next);
        } catch (loadError) {
            if (loadError instanceof ApiHttpError) {
                setErrorStatus(loadError.status);
                setError(loadError.message);
            } else {
                setErrorStatus(500);
                setError(loadError instanceof Error ? loadError.message : "Failed to load task");
            }
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [taskId]);

    const latestExecution = (task?.executionActions ?? [])
        .filter((action) => action.executionState)
        .at(-1);
    const failed = latestExecution?.executionState === "failed";
    const canCancel = Boolean(
        task && !task.cancelRequestedAt && task.coordinationStatus !== "COMPLETED" && task.coordinationStatus !== "CANCELLED"
    );

    async function cancel() {
        if (!task) return;
        setActing(true);
        try {
            await authenticatedFetch(`/api/tasks/${encodeURIComponent(task._id)}/cancel`, {
                method: "POST",
                body: JSON.stringify({ reason: "Cancelled from work detail." }),
            });
            await load();
        } catch (cancelError) {
            setError(cancelError instanceof Error ? cancelError.message : "Cancel failed");
        } finally {
            setActing(false);
        }
    }

    async function retry() {
        if (!task) return;
        setActing(true);
        try {
            await requestTaskExecutionApi(task._id, { reason: "Retry failed execution." });
            await load();
        } catch (retryError) {
            setError(retryError instanceof Error ? retryError.message : "Retry failed");
        } finally {
            setActing(false);
        }
    }

    if (loading) {
        return (
            <div className="w-full max-w-6xl px-4 py-4 lg:px-5" data-testid="work-task-loading">
                <p className="text-sm text-muted-foreground">Loading work…</p>
            </div>
        );
    }

    if (errorStatus === 401 || errorStatus === 403) {
        return (
            <div className="w-full max-w-6xl space-y-1 px-4 py-4 lg:px-5" data-testid="work-task-forbidden">
                <h1 className="text-lg font-semibold">Unable to view work</h1>
                <p className="text-sm text-muted-foreground">{error || "You do not have access to this task."}</p>
            </div>
        );
    }

    if (!task) {
        return (
            <div className="w-full max-w-6xl space-y-1 px-4 py-4 lg:px-5" data-testid="work-task-not-found">
                <h1 className="text-lg font-semibold">Work not found</h1>
                <p className="text-sm text-muted-foreground">{error || "This task does not exist."}</p>
            </div>
        );
    }

    const assignees = task.assigneeRefs ?? [];
    const actions = task.executionActions ?? [];

    return (
        <div className="w-full max-w-6xl px-4 py-4 lg:px-5" data-testid="work-task-detail">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-[auto_1fr] lg:items-start">
                <article className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)] lg:col-start-1 lg:row-start-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <PriorityBadge priority={task.priority} />
                        <span>{SOURCE_LABELS[task.source] ?? task.source}</span>
                        <span aria-hidden="true">·</span>
                        <span>Created {formatTimestamp(task.createdAt)}</span>
                    </div>
                    <h1 className="mt-2 text-lg font-semibold leading-snug text-foreground">{task.title}</h1>

                    <h2 className="mt-4 text-xs font-medium text-muted-foreground">Description</h2>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-foreground" data-testid="work-task-description">
                        {task.description || "No description."}
                    </p>

                    <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
                        <div className="space-y-1">
                            <dt className={FIELD_LABEL}>Owner</dt>
                            <dd data-testid="work-task-owner">
                                {task.ownerRef ? <UserChip user={task.ownerRef} size={20} /> : "Unassigned"}
                            </dd>
                        </div>
                        <div className="space-y-1">
                            <dt className={FIELD_LABEL}>Due date</dt>
                            <dd className="font-medium">{formatDue(task.dueAt)}</dd>
                        </div>
                        <div className="space-y-1">
                            <dt className={FIELD_LABEL}>Assignees</dt>
                            <dd className="flex flex-wrap gap-x-3 gap-y-1">
                                {assignees.length > 0
                                    ? assignees.map((user) => <UserChip key={user.id} user={user} size={20} />)
                                    : <span className="text-muted-foreground">No assignees</span>}
                            </dd>
                        </div>
                        <div className="space-y-1">
                            <dt className={FIELD_LABEL}>Priority</dt>
                            <dd>
                                <PriorityBadge priority={task.priority} />
                            </dd>
                        </div>
                    </dl>
                </article>

                <aside className="space-y-3 lg:col-start-2 lg:row-span-2 lg:row-start-1">
                    {error ? <p className="text-sm text-destructive">{error}</p> : null}

                    <section className={RAIL_SECTION}>
                        <h2 className={RAIL_HEADING}>Coordination</h2>
                        <p className="mt-1.5 text-sm font-medium text-foreground" data-testid="work-task-status">
                            {coordinationLabel(task.coordinationStatus ?? task.boardStatus)}
                        </p>
                        <div className="mt-2 grid grid-cols-3 gap-1" aria-label="Board status">
                            {BOARD_ORDER.map((status) => {
                                const active = task.boardStatus === status;
                                return (
                                    <span
                                        key={status}
                                        aria-current={active ? "step" : undefined}
                                        data-testid={active ? "work-task-board-status" : undefined}
                                        className={cn(
                                            "rounded-md px-2 py-1 text-center text-[11px]",
                                            active ? "bg-primary/10 font-medium text-primary" : "bg-muted text-muted-foreground"
                                        )}
                                    >
                                        {BOARD_LABELS[status]}
                                    </span>
                                );
                            })}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <Button asChild variant="outline" size="sm" className="h-8">
                                <Link href={boardTaskHref(task._id, task.conversationId)}>Open board</Link>
                            </Button>
                            {canCancel ? (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 text-muted-foreground"
                                    onClick={() => void cancel()}
                                    disabled={acting}
                                    data-testid="work-task-cancel"
                                >
                                    Cancel task
                                </Button>
                            ) : null}
                        </div>
                    </section>

                    <section className={RAIL_SECTION}>
                        <h2 className={RAIL_HEADING}>Execution</h2>
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground">Run status</span>
                            <span
                                className={cn(
                                    "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                                    task.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground"
                                )}
                                data-testid="work-task-run-status"
                            >
                                {runStateLabel(task.status)}
                            </span>
                        </div>
                        {latestExecution ? (
                            <div className="mt-2 space-y-1 border-t border-border pt-2 text-xs" data-testid="work-task-execution">
                                {latestExecution.toolName && latestExecution.toolName !== "none" ? (
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">Tool</span>
                                        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
                                            {latestExecution.toolName}
                                        </code>
                                    </div>
                                ) : null}
                                <p className="text-foreground">{actionLabel(latestExecution)}</p>
                                <p className="text-muted-foreground">{formatTimestamp(latestExecution.createdAt)}</p>
                                {latestExecution.error ? (
                                    <p className="text-destructive" data-testid="work-task-execution-error">
                                        {latestExecution.error}
                                    </p>
                                ) : null}
                            </div>
                        ) : (
                            <p className="mt-2 text-xs text-muted-foreground">No tool has been requested for this task.</p>
                        )}
                        {task.coordinationStatus === "AWAITING_APPROVAL" || latestExecution?.executionState === "approval_pending" ? (
                            <Button asChild size="sm" className="mt-3 h-8 w-full">
                                <Link href="/inbox/approvals">Review action</Link>
                            </Button>
                        ) : null}
                        {failed ? (
                            <Button
                                size="sm"
                                className="mt-3 h-8 w-full"
                                onClick={() => void retry()}
                                disabled={acting}
                                data-testid="work-task-retry"
                            >
                                Retry
                            </Button>
                        ) : null}
                        <p className="mt-2 text-[11px] text-muted-foreground">
                            Run status is separate from coordination.
                        </p>
                    </section>

                    <section className={RAIL_SECTION}>
                        <h2 className={RAIL_HEADING}>Source</h2>
                        <p className="mt-1.5 flex items-center gap-2 text-sm font-medium text-foreground">
                            <MessageSquareText aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                            <span className="truncate">{task.conversationLabel?.trim() || "Conversation"}</span>
                        </p>
                        {task.suggestionId ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">Created from an accepted suggestion.</p>
                        ) : null}
                        <Link
                            href={conversationMessageHref(task.conversationId, task.sourceMessageIds[0])}
                            className="mt-2 inline-flex text-xs font-medium text-primary hover:underline"
                            data-testid="work-task-source"
                        >
                            View original message
                        </Link>
                    </section>
                </aside>

                <section className="min-w-0 lg:col-start-1 lg:row-start-2">
                    <h2 className="text-sm font-semibold text-foreground">Activity</h2>
                    <ol className="mt-2" data-testid="work-task-timeline">
                        {actions.length === 0 ? (
                            <li className="text-sm text-muted-foreground">Suggestion created → Accepted</li>
                        ) : (
                            actions.map((action, index) => (
                                <li key={action._id} className="relative flex gap-3 pb-3 last:pb-0">
                                    {index < actions.length - 1 ? (
                                        <span aria-hidden="true" className="absolute left-[5px] top-3 h-full w-px bg-border" />
                                    ) : null}
                                    <span aria-hidden="true" className="relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-background bg-primary/60 ring-1 ring-border" />
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-foreground">{actionLabel(action)}</p>
                                        <p className="text-xs text-muted-foreground">{formatTimestamp(action.createdAt)}</p>
                                    </div>
                                </li>
                            ))
                        )}
                    </ol>
                </section>
            </div>
        </div>
    );
}
