"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TaskActionRecord, TaskRecord } from "@semantask/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserChip } from "@/components/people/user-chip";
import { conversationMessageHref } from "@/lib/work-links";
import { ApiHttpError, authenticatedFetch, getTask, requestTaskExecutionApi } from "@/lib/utils/api";

const BOARD_LABELS: Record<string, string> = {
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

function formatTimestamp(iso: string | null | undefined) {
    if (!iso) return "—";
    const value = new Date(iso);
    if (Number.isNaN(value.getTime())) return "—";
    return value.toLocaleString();
}

function formatDue(iso: string | null | undefined) {
    if (!iso) return "No due date";
    const value = new Date(iso);
    if (Number.isNaN(value.getTime())) return "No due date";
    return value.toLocaleDateString();
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
            <div className="mx-auto max-w-3xl space-y-4 p-6" data-testid="work-task-loading">
                <p className="text-sm text-muted-foreground">Loading work…</p>
            </div>
        );
    }

    if (errorStatus === 401 || errorStatus === 403) {
        return (
            <div className="mx-auto max-w-3xl space-y-4 p-6" data-testid="work-task-forbidden">
                <h1 className="text-2xl font-bold">Unable to view work</h1>
                <p className="text-sm text-muted-foreground">{error || "You do not have access to this task."}</p>
            </div>
        );
    }

    if (!task) {
        return (
            <div className="mx-auto max-w-3xl space-y-4 p-6" data-testid="work-task-not-found">
                <h1 className="text-2xl font-bold">Work not found</h1>
                <p className="text-sm text-muted-foreground">{error || "This task does not exist."}</p>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-3xl space-y-6 p-6" data-testid="work-task-detail">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Work</p>
                    <h1 className="text-2xl font-bold">{task.title}</h1>
                    <p className="text-sm text-muted-foreground" data-testid="work-task-status">
                        {task.coordinationStatus ?? task.boardStatus}
                    </p>
                    <p className="text-sm text-foreground" data-testid="work-task-board-status">
                        Board: {BOARD_LABELS[task.boardStatus] ?? task.boardStatus}
                    </p>
                    <p className="text-sm text-foreground" data-testid="work-task-run-status">
                        Run: {runStateLabel(task.status)}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {failed ? (
                        <Button size="sm" onClick={() => void retry()} disabled={acting} data-testid="work-task-retry">
                            Retry
                        </Button>
                    ) : null}
                    {canCancel ? (
                        <Button size="sm" variant="outline" onClick={() => void cancel()} disabled={acting} data-testid="work-task-cancel">
                            Cancel
                        </Button>
                    ) : null}
                    <Button asChild variant="outline" size="sm">
                        <Link href="/inbox/board">Board</Link>
                    </Button>
                </div>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    <p className="whitespace-pre-wrap text-muted-foreground" data-testid="work-task-description">
                        {task.description || "No description."}
                    </p>
                    <dl className="grid gap-3 sm:grid-cols-2">
                        <div>
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Owner</dt>
                            <dd data-testid="work-task-owner">
                                {task.ownerRef ? <UserChip user={task.ownerRef} /> : "Unassigned"}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Due</dt>
                            <dd>{formatDue(task.dueAt)}</dd>
                        </div>
                        <div>
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Priority</dt>
                            <dd className="capitalize">{task.priority}</dd>
                        </div>
                        <div>
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Source conversation</dt>
                            <dd>
                                <Link
                                    href={conversationMessageHref(task.conversationId, task.sourceMessageIds[0])}
                                    className="underline underline-offset-2"
                                    data-testid="work-task-source"
                                >
                                    {task.conversationLabel?.trim() || "Open conversation"}
                                </Link>
                            </dd>
                        </div>
                    </dl>
                </CardContent>
            </Card>

            {latestExecution ? (
                <Card data-testid="work-task-execution">
                    <CardHeader>
                        <CardTitle className="text-base">Execution</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        <p>Status: {latestExecution.executionState}</p>
                        <p>Action: {(latestExecution.toolName || latestExecution.actionType).replace(/_/g, " ")}</p>
                        {latestExecution.error ? (
                            <p className="text-destructive" data-testid="work-task-execution-error">
                                {latestExecution.error}
                            </p>
                        ) : null}
                        <p className="text-muted-foreground">{formatTimestamp(latestExecution.createdAt)}</p>
                    </CardContent>
                </Card>
            ) : null}

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Activity</CardTitle>
                </CardHeader>
                <CardContent>
                    <ol className="space-y-2 text-sm" data-testid="work-task-timeline">
                        {(task.executionActions ?? []).length === 0 ? (
                            <li className="text-muted-foreground">Suggestion created → Accepted</li>
                        ) : (
                            (task.executionActions ?? []).map((action) => (
                                <li key={action._id} className="rounded-md border border-border px-3 py-2">
                                    <p className="font-medium">{actionLabel(action)}</p>
                                    <p className="text-xs text-muted-foreground">{formatTimestamp(action.createdAt)}</p>
                                </li>
                            ))
                        )}
                    </ol>
                </CardContent>
            </Card>
        </div>
    );
}
