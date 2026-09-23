"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { TaskExecutionEventRecord, TaskRecord, TaskStatus } from "@semantask/types";
import { authenticatedFetch } from "@/lib/utils/api";
import { getSocket } from "@/hooks/socketClient";
import { useTaskExecution } from "@/hooks/useTaskExecution";
import { useDeepLinkScroll } from "@/hooks/useDeepLinkScroll";
import useTaskStore from "@/store/task-store";
import { Button } from "@/components/ui/button";
import { Check, ListChecks, Loader2 } from "lucide-react";
import { taskHref } from "@/lib/work-links";
import { PriorityBadge } from "@/components/work-suggestions/priority-badge";
import { reviewSuggestionHref } from "@/lib/work-suggestions/map";
import {
    DEEP_LINK_HIGHLIGHT_CLASS,
    taskPanelElementId,
} from "@/lib/deep-link-highlight";
import { cn } from "@/lib/utils/utils";

interface TaskPanelProps {
    conversationId: string;
    mobileOpen?: boolean;
    onMobileOpenChange?: (open: boolean) => void;
}

const TASK_STATUSES: TaskStatus[] = ["pending", "executing", "completed", "failed", "partial"];
const EMPTY_TASK_IDS: string[] = [];
const EMPTY_STEPS: ExecutionStep[] = [];
const EMPTY_EXECUTION_EVENTS: TaskExecutionEventRecord[] = [];

type ExecutionStepStatus = "pending" | "running" | "completed";

interface ExecutionStep {
    id: string;
    label: string;
    detail: string;
    status: ExecutionStepStatus;
}

interface TaskInlineCardProps {
    task: TaskRecord;
    highlighted?: boolean;
    onStatusChange: (taskId: string, status: TaskStatus) => void;
    onCancel: (taskId: string) => Promise<void>;
}

function formatDueDate(value: string | null) {
    if (!value) return "No due date";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "No due date";
    return parsed.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function getProgressValue(steps: ExecutionStep[]) {
    if (steps.length === 0) return 0;
    const completed = steps.filter((step) => step.status === "completed").length;
    return (completed / steps.length) * 100;
}

function getStepTone(status: ExecutionStepStatus) {
    switch (status) {
        case "running":
            return {
                border: "border-blue-500/40 dark:border-blue-400/30",
                background: "bg-blue-500/10",
                text: "text-blue-900 dark:text-blue-50",
                detail: "text-blue-800/85 dark:text-blue-100/70",
                ring: "ring-blue-500/25 dark:ring-blue-400/20",
            };
        case "completed":
            return {
                border: "border-emerald-500/35 dark:border-emerald-400/25",
                background: "bg-emerald-500/10",
                text: "text-emerald-900 dark:text-emerald-50",
                detail: "text-emerald-800/85 dark:text-emerald-100/70",
                ring: "ring-emerald-500/25 dark:ring-emerald-400/20",
            };
        default:
            return {
                border: "border-border",
                background: "bg-muted/50",
                text: "text-foreground",
                detail: "text-muted-foreground",
                ring: "ring-border/60",
            };
    }
}

const StepRow = memo(function StepRow({
    step,
    shouldReduceMotion,
}: {
    step: ExecutionStep;
    shouldReduceMotion: boolean;
}) {
    const tone = getStepTone(step.status);

    return (
        <motion.div
            layout="position"
            initial={false}
            animate={
                shouldReduceMotion
                    ? { opacity: 1, y: 0 }
                    : step.status === "pending"
                        ? { opacity: 0.58, y: 0 }
                        : step.status === "running"
                            ? { opacity: 1, y: -2 }
                            : { opacity: 1, y: 0 }
            }
            transition={{ duration: 0.24, ease: "easeOut" }}
            className={`mb-2 flex items-start gap-3 rounded-lg border px-3 py-3 ring-1 last:mb-0 ${tone.border} ${tone.background} ${tone.ring}`}
        >
            <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                <AnimatePresence mode="wait" initial={false}>
                    {step.status === "running" ? (
                        <motion.span
                            key="running"
                            initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.9 }}
                            animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, scale: [0.96, 1.06, 0.96] }}
                            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                            transition={{ duration: 0.7, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                            className="relative flex h-5 w-5 items-center justify-center rounded-full bg-blue-500/15 dark:bg-blue-400/15"
                        >
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 dark:text-blue-200" />
                        </motion.span>
                    ) : step.status === "completed" ? (
                        <motion.span
                            key="completed"
                            initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.6 }}
                            animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, scale: [0.8, 1.08, 1] }}
                            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                            transition={{ duration: 0.24, ease: "easeOut" }}
                            className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 dark:bg-emerald-400/15"
                        >
                            <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" />
                        </motion.span>
                    ) : (
                        <motion.span
                            key="pending"
                            initial={shouldReduceMotion ? false : { opacity: 0.45 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-muted/80"
                        >
                            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70" />
                        </motion.span>
                    )}
                </AnimatePresence>
            </div>

            <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${tone.text}`}>{step.label}</p>
                <p className={`mt-0.5 text-xs leading-5 ${tone.detail}`}>{step.detail}</p>
            </div>
        </motion.div>
    );
});

function canCancelTask(task: TaskRecord): boolean {
    return task.lifecycleState !== "completed"
        && task.lifecycleState !== "failed"
        && task.status !== "completed"
        && task.status !== "failed"
        && !task.cancelRequestedAt;
}

function TaskInlineCard({ task, highlighted = false, onStatusChange, onCancel }: TaskInlineCardProps) {
    const shouldReduceMotion = useReducedMotion();
    const executionView = useTaskExecution(task._id);
    const setExecutionEvents = useTaskStore((state) => state.setExecutionEvents);
    const appendExecutionEvent = useTaskStore((state) => state.appendExecutionEvent);
    const executionEvents = useTaskStore((state) => state.executionEventsByTaskId[task._id] ?? EMPTY_EXECUTION_EVENTS);
    const executionEventsRef = useRef(executionEvents);
    useEffect(() => {
        executionEventsRef.current = executionEvents;
    }, [executionEvents]);

    const steps = useMemo(
        () => executionView.steps.map((step) => ({
            id: step.id,
            label: step.label,
            detail: step.detail,
            status: step.status,
        })),
        [executionView.steps]
    );

    const progress = executionView.progress > 0 ? executionView.progress : getProgressValue(steps);
    const hasRunningStep = steps.some((step) => step.status === "running") || task.status === "executing";
    const showCancel = canCancelTask(task);

    const replayExecutionEvents = useCallback(async () => {
        const currentEvents = executionEventsRef.current;
        const activeRunId = task.executionRunId ?? currentEvents.at(-1)?.runId ?? null;
        const runEvents = activeRunId
            ? currentEvents.filter((event) => event.runId === activeRunId)
            : currentEvents;
        const lastSequence = runEvents.reduce((max, event) => Math.max(max, event.sequence), 0);
        const searchParams = new URLSearchParams({ afterSequence: String(lastSequence) });
        if (activeRunId) {
            searchParams.set("runId", activeRunId);
        }

        try {
            const response = await authenticatedFetch(
                `/api/tasks/${task._id}/execution-events?${searchParams.toString()}`
            );
            if (!response.ok) return;
            const payload = (await response.json()) as { events: TaskExecutionEventRecord[] };
            if (payload.events.length === 0) {
                return;
            }
            if (currentEvents.length === 0) {
                setExecutionEvents(task._id, payload.events);
                return;
            }
            for (const event of payload.events) {
                appendExecutionEvent(event);
            }
        } catch (error) {
            console.error("Failed to replay task execution events", error);
        }
    }, [appendExecutionEvent, setExecutionEvents, task._id, task.executionRunId]);

    useEffect(() => {
        void replayExecutionEvents();
    }, [replayExecutionEvents]);

    useEffect(() => {
        const socket = getSocket();
        const onConnect = () => {
            void replayExecutionEvents();
        };
        socket.on("connect", onConnect);
        return () => {
            socket.off("connect", onConnect);
        };
    }, [replayExecutionEvents]);

    return (
        <motion.article
            layout
            id={taskPanelElementId(task._id)}
            data-testid="task-panel-card"
            data-highlighted={highlighted ? "true" : "false"}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
            animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={cn(
                "overflow-hidden rounded-lg border border-border bg-background p-3 text-card-foreground",
                highlighted && DEEP_LINK_HIGHLIGHT_CLASS
            )}
        >
            <div className="flex items-start gap-2.5">
                <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
                >
                    <ListChecks className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                    <h4 className="truncate text-[13px] font-semibold text-foreground">
                        <Link
                            href={taskHref(task._id)}
                            className="hover:underline"
                            data-testid="task-panel-task-link"
                        >
                            {task.title}
                        </Link>
                    </h4>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
                        {task.priority ? <PriorityBadge priority={task.priority} className="py-0" /> : null}
                        <span>{task.source === "ai" ? "From chat" : task.source === "manual" ? "Manual" : "Imported"}</span>
                        <span aria-hidden="true">·</span>
                        <span>{task.dueAt ? `Due ${formatDueDate(task.dueAt)}` : "No due date"}</span>
                        {task.suggestionId ? (
                            <>
                                <span aria-hidden="true">·</span>
                                <Link
                                    href={reviewSuggestionHref(task.suggestionId) ?? "#"}
                                    className="underline underline-offset-2 hover:text-foreground"
                                    data-testid="task-panel-suggestion-link"
                                >
                                    Suggestion
                                </Link>
                            </>
                        ) : null}
                    </p>
                    {task.description && (
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{task.description}</p>
                    )}
                </div>
            </div>

            <div className={cn((executionView.runId || executionView.failureReason || executionView.retryStatus || executionView.approvalPending || task.cancelRequestedAt || hasRunningStep || steps.length > 0) && "mt-2.5")}>
                {executionView.runId && (
                    <p className="mb-2 font-mono text-[10px] text-muted-foreground">
                        run {executionView.runId}
                        {executionView.durationMs !== null ? ` · ${Math.round(executionView.durationMs / 1000)}s` : ""}
                    </p>
                )}
                {executionView.failureReason && (
                    <p className="mb-2 text-xs text-destructive">{executionView.failureReason}</p>
                )}
                {executionView.retryStatus && (
                    <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">{executionView.retryStatus}</p>
                )}
                {executionView.approvalPending && (
                    <div className="mb-2 space-y-1">
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                            Awaiting human approval to allow AI tools
                        </p>
                        <Button asChild size="sm" variant="outline" data-testid="task-panel-allow-ai-tools">
                            <Link href="/inbox/approvals">Allow AI tools</Link>
                        </Button>
                    </div>
                )}
                {task.cancelRequestedAt && task.status !== "failed" && task.status !== "completed" && (
                    <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">Cancellation requested…</p>
                )}
                {steps.length === 0 && task.status === "executing" && (
                    <p className="mb-2 text-xs text-muted-foreground">Waiting for execution telemetry...</p>
                )}
                {hasRunningStep && (
                    <motion.div
                        initial={shouldReduceMotion ? false : { opacity: 0 }}
                        animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1 }}
                        className="mb-3 flex items-center gap-2 text-xs text-blue-800 dark:text-blue-100"
                    >
                        <motion.span
                            animate={shouldReduceMotion ? undefined : { opacity: [0.45, 1, 0.45], scale: [0.98, 1, 0.98] }}
                            transition={{ duration: 1.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                            className="inline-flex h-2 w-2 rounded-full bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.55)] dark:bg-blue-400 dark:shadow-[0_0_16px_rgba(96,165,250,0.8)]"
                        />
                        <span className="font-medium">Updating…</span>
                        <span className="flex items-center gap-0.5 text-blue-700/80 dark:text-blue-200/70">
                            <motion.span
                                animate={shouldReduceMotion ? undefined : { opacity: [0.2, 1, 0.2] }}
                                transition={{ duration: 1, repeat: Number.POSITIVE_INFINITY, delay: 0, ease: "easeInOut" }}
                            >
                                .
                            </motion.span>
                            <motion.span
                                animate={shouldReduceMotion ? undefined : { opacity: [0.2, 1, 0.2] }}
                                transition={{ duration: 1, repeat: Number.POSITIVE_INFINITY, delay: 0.2, ease: "easeInOut" }}
                            >
                                .
                            </motion.span>
                            <motion.span
                                animate={shouldReduceMotion ? undefined : { opacity: [0.2, 1, 0.2] }}
                                transition={{ duration: 1, repeat: Number.POSITIVE_INFINITY, delay: 0.4, ease: "easeInOut" }}
                            >
                                .
                            </motion.span>
                        </span>
                    </motion.div>
                )}

                <AnimatePresence initial={false} mode="popLayout">
                    {steps.map((step) => (
                        <StepRow key={step.id} step={step} shouldReduceMotion={Boolean(shouldReduceMotion)} />
                    ))}
                </AnimatePresence>
            </div>

            {steps.length > 0 ? (
                <div className="mt-2 space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{Math.round(progress)}% complete</span>
                        <span>{steps.filter((step) => step.status === "completed").length} of {steps.length} steps done</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-muted">
                        <motion.div
                            layout
                            className="h-full rounded-full bg-primary"
                            initial={false}
                            animate={{ width: `${progress}%` }}
                            transition={{ duration: 0.35, ease: "easeOut" }}
                        />
                    </div>
                </div>
            ) : null}

            <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border pt-2.5">
                <label className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
                    Run status
                    <select
                        value={task.status}
                        className="h-7 rounded-md border border-input bg-background px-1.5 text-[11px] capitalize text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                        onChange={(event) => onStatusChange(task._id, event.target.value as TaskStatus)}
                    >
                        {TASK_STATUSES.map((status) => (
                            <option key={status} value={status}>
                                {status.replace("_", " ")}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="flex shrink-0 items-center gap-1.5">
                    {showCancel && (
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 rounded-md px-2 text-[11px] text-muted-foreground"
                            onClick={() => void onCancel(task._id)}
                        >
                            Cancel
                        </Button>
                    )}
                    <Button asChild size="sm" variant="outline" className="h-7 rounded-md px-2.5 text-[11px]">
                        <Link href={taskHref(task._id)}>View task</Link>
                    </Button>
                </div>
            </div>
        </motion.article>
    );
}

export default function TaskPanel({
    conversationId,
    mobileOpen = false,
    onMobileOpenChange,
}: TaskPanelProps) {
    const searchParams = useSearchParams();
    const highlightedTaskId = searchParams.get("task");
    const [dismissedHighlight, setDismissedHighlight] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [newTaskTitle, setNewTaskTitle] = useState("");
    const [newTaskDescription, setNewTaskDescription] = useState("");

    const setConversationTasks = useTaskStore((state) => state.setConversationTasks);
    const upsertTask = useTaskStore((state) => state.upsertTask);
    const tasksById = useTaskStore((state) => state.tasksById);
    const conversationTaskIds = useTaskStore((state) => state.tasksByConversation[conversationId] ?? EMPTY_TASK_IDS);

    const tasks = useMemo(() => {
        return conversationTaskIds
            .map((id) => tasksById[id])
            .filter((task): task is TaskRecord => Boolean(task))
            .sort((left, right) => {
                if (left.status !== right.status) {
                    return left.status.localeCompare(right.status);
                }
                return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
            });
    }, [conversationTaskIds, tasksById]);

    const highlightedOnPage = Boolean(
        highlightedTaskId && tasks.some((task) => task._id === highlightedTaskId)
    );
    const highlightOpen = Boolean(highlightedTaskId) && dismissedHighlight !== highlightedTaskId;
    const showMobileTaskSurface = mobileOpen || highlightOpen;
    useDeepLinkScroll(
        highlightedTaskId ? taskPanelElementId(highlightedTaskId) : null,
        highlightedOnPage
    );

    const loadTasks = useCallback(
        async (opts?: { silent?: boolean }) => {
            if (!opts?.silent) {
                setLoading(true);
            }
            try {
                const response = await authenticatedFetch(`/api/tasks?conversationId=${conversationId}`);
                if (!response.ok) return;
                const payload = (await response.json()) as TaskRecord[];
                setConversationTasks(conversationId, payload);
            } catch (error) {
                console.error("Failed to load tasks", error);
            } finally {
                if (!opts?.silent) {
                    setLoading(false);
                }
            }
        },
        [conversationId, setConversationTasks]
    );

    useEffect(() => {
        void loadTasks();
    }, [loadTasks]);

    useEffect(() => {
        const socket = getSocket();
        const onConnect = () => {
            void loadTasks({ silent: true });
        };
        socket.on("connect", onConnect);
        return () => {
            socket.off("connect", onConnect);
        };
    }, [loadTasks]);

    const createTask = async () => {
        const title = newTaskTitle.trim();
        if (title.length < 3) return;

        setCreating(true);
        try {
            const response = await authenticatedFetch("/api/tasks", {
                method: "POST",
                body: JSON.stringify({
                    conversationId,
                    title,
                    description: newTaskDescription.trim(),
                }),
            });

            if (!response.ok) {
                throw new Error("Failed to create task");
            }

            const created = (await response.json()) as TaskRecord;
            upsertTask(created);
            setNewTaskTitle("");
            setNewTaskDescription("");
        } catch (error) {
            console.error("Failed to create task", error);
        } finally {
            setCreating(false);
        }
    };

    const updateTaskStatus = async (taskId: string, status: TaskStatus) => {
        try {
            const response = await authenticatedFetch(`/api/tasks/${taskId}`, {
                method: "PATCH",
                body: JSON.stringify({ status }),
            });
            if (!response.ok) {
                throw new Error("Failed to update task status");
            }

            const updated = (await response.json()) as TaskRecord;
            upsertTask(updated);
        } catch (error) {
            console.error("Failed to update task", error);
        }
    };

    const cancelTask = async (taskId: string) => {
        try {
            const response = await authenticatedFetch(`/api/tasks/${taskId}/cancel`, {
                method: "POST",
                body: JSON.stringify({ reason: "Cancelled from task panel." }),
            });
            if (response.status === 409) {
                console.warn("Task is already terminal");
                return;
            }
            if (!response.ok) {
                throw new Error("Failed to cancel task");
            }

            const updated = (await response.json()) as TaskRecord;
            upsertTask(updated);
        } catch (error) {
            console.error("Failed to cancel task", error);
        }
    };

    return (
        <>
            {showMobileTaskSurface ? (
                <div
                    className="fixed inset-0 z-40 bg-black/40 lg:hidden"
                    data-testid="task-panel-mobile-backdrop"
                    aria-hidden="true"
                    onClick={() => {
                        onMobileOpenChange?.(false);
                        if (highlightedTaskId) setDismissedHighlight(highlightedTaskId);
                    }}
                />
            ) : null}
            <aside
                data-testid="task-panel"
                data-mobile-visible={showMobileTaskSurface ? "true" : "false"}
                className={cn(
                    "min-h-0 shrink-0 border-l border-border bg-card text-foreground",
                    showMobileTaskSurface
                        ? "fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col shadow-xl lg:static lg:z-auto lg:w-[340px] lg:shadow-none"
                        : "hidden w-[340px] lg:flex lg:flex-col"
                )}
            >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
                <div className="flex items-center gap-2">
                    <h3 className="text-[13px] font-semibold text-foreground">Work from this conversation</h3>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {tasks.length}
                    </span>
                </div>
                <button
                    type="button"
                    className="inline-flex h-7 items-center rounded-md border border-border px-2 text-[11px] lg:hidden"
                    data-testid="task-panel-close"
                    onClick={() => {
                        onMobileOpenChange?.(false);
                        if (highlightedTaskId) setDismissedHighlight(highlightedTaskId);
                    }}
                >
                    Close
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {loading && <p className="text-xs text-muted-foreground">Loading tasks...</p>}

                {!loading && tasks.length === 0 && (
                    <p className="text-xs text-muted-foreground">No tasks yet for this conversation.</p>
                )}

                <AnimatePresence initial={false} mode="popLayout">
                    <div className="space-y-2">
                        {tasks.map((task) => (
                            <TaskInlineCard
                                key={task._id}
                                task={task}
                                highlighted={task._id === highlightedTaskId}
                                onStatusChange={updateTaskStatus}
                                onCancel={cancelTask}
                            />
                        ))}
                    </div>
                </AnimatePresence>
            </div>

            <div className="shrink-0 space-y-2 border-t border-border p-3">
                <div className="flex gap-2">
                    <input
                        className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
                        value={newTaskTitle}
                        placeholder="Create a task"
                        aria-label="Task title"
                        onChange={(event) => setNewTaskTitle(event.target.value)}
                    />
                    <Button
                        size="sm"
                        disabled={creating || newTaskTitle.trim().length < 3}
                        onClick={createTask}
                        className="h-8 rounded-lg"
                        variant="outline"
                    >
                        {creating ? "Creating..." : "Create"}
                    </Button>
                </div>
                {newTaskTitle.trim().length > 0 || newTaskDescription.length > 0 ? (
                    <textarea
                        className="max-h-16 min-h-10 w-full resize-y rounded-lg border border-input bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
                        value={newTaskDescription}
                        placeholder="Description (optional)"
                        aria-label="Task description"
                        onChange={(event) => setNewTaskDescription(event.target.value)}
                    />
                ) : null}
            </div>
            </aside>
        </>
    );
}