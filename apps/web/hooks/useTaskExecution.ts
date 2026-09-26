"use client";

import { useMemo } from "react";
import type { TaskExecutionEventRecord, TaskExecutionUpdatedPayload } from "@semantask/types";
import useTaskStore from "@/store/task-store";

const EMPTY_EXECUTION_EVENTS: TaskExecutionEventRecord[] = [];

export type ExecutionStepStatus = "pending" | "running" | "completed";

export interface DerivedExecutionStep {
    id: string;
    label: string;
    detail: string;
    status: ExecutionStepStatus;
}

export interface TaskExecutionView {
    phase: string | null;
    activeTool: string | null;
    retryStatus: string | null;
    approvalPending: boolean;
    verification: boolean;
    progress: number;
    durationMs: number | null;
    runId: string | null;
    failureReason: string | null;
    steps: DerivedExecutionStep[];
}

function eventDedupeKey(event: TaskExecutionEventRecord): string {
    return `${event.runId}:${event.sequence}`;
}

function nonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function humanizeEventType(type: string): string {
    const raw = type.replace(/_/g, " ").trim();
    if (!raw) return "Execution update";
    return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function isTerminalEventType(type: TaskExecutionEventRecord["type"]): boolean {
    return type === "execution_completed" || type === "execution_failed" || type === "tool_failed";
}

function isTerminalLatestState(
    state: TaskExecutionUpdatedPayload["state"] | undefined
): boolean {
    return state === "failed" || state === "succeeded" || state === "cancelled" || state === "blocked";
}

function mapEventToStep(event: TaskExecutionEventRecord, index: number): DerivedExecutionStep {
    const payload = event.payload ?? {};
    const summary = nonEmptyString(payload.summary) ?? humanizeEventType(event.type);
    const error = nonEmptyString(payload.error);
    const toolName = nonEmptyString(payload.toolName);
    const phase = nonEmptyString(event.phase);

    let status: ExecutionStepStatus = "completed";
    if (event.type === "tool_started" || event.type === "execution_started" || event.type === "retry_started") {
        status = "running";
    }

    return {
        id: `${event.runId}-${event.sequence}-${index}`,
        label: summary,
        detail: error ?? toolName ?? phase ?? "",
        status,
    };
}

function deriveStepsFromEvents(
    events: TaskExecutionEventRecord[],
    options: { terminal: boolean }
): DerivedExecutionStep[] {
    if (events.length === 0) {
        return [];
    }

    const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
    const unique = new Map<string, TaskExecutionEventRecord>();
    for (const event of sorted) {
        unique.set(eventDedupeKey(event), event);
    }

    const deduped = Array.from(unique.values()).sort((a, b) => a.sequence - b.sequence);
    const steps = deduped.map(mapEventToStep).filter((step) => step.label.length > 0);

    if (options.terminal) {
        for (const step of steps) {
            if (step.status === "running") {
                step.status = "completed";
            }
        }
        return steps;
    }

    if (steps.length > 0) {
        const last = steps[steps.length - 1];
        const lastEvent = deduped[deduped.length - 1];
        if (!isTerminalEventType(lastEvent.type)) {
            last.status = "running";
        }
    }

    return steps;
}

function deriveFromLatestPayload(latest: TaskExecutionUpdatedPayload | undefined): Partial<TaskExecutionView> {
    if (!latest) {
        return {};
    }

    return {
        phase: latest.phase ?? null,
        activeTool: latest.details?.toolName ?? null,
        retryStatus: latest.step === "retry_scheduled" ? latest.summary : null,
        approvalPending: latest.state === "approval_pending",
        verification: latest.step === "verify_result" || latest.step === "verification_completed",
        progress: typeof latest.progress === "number" ? latest.progress : 0,
        runId: latest.runId ?? null,
        failureReason: nonEmptyString(latest.error),
    };
}

export function deriveExecutionView(
    events: TaskExecutionEventRecord[],
    latest?: TaskExecutionUpdatedPayload
): TaskExecutionView {
    const fromLatest = deriveFromLatestPayload(latest);
    const failedEvent = [...events].reverse().find((event) => event.type === "execution_failed");
    const failedFromEvents = Boolean(failedEvent);
    const completedFromEvents = events.some((event) => event.type === "execution_completed");
    const failedEventReason = failedEvent
        ? nonEmptyString(failedEvent.payload?.error) ?? nonEmptyString(failedEvent.payload?.summary)
        : null;
    const terminal = Boolean(
        isTerminalLatestState(latest?.state)
        || failedFromEvents
        || completedFromEvents
    );
    const steps = deriveStepsFromEvents(events, { terminal });

    const startedAt = events.find((event) => event.type === "execution_started")?.createdAt
        ?? (latest?.updatedAt ? String(latest.updatedAt) : null);
    const endedAt = events.find((event) =>
        event.type === "execution_completed" || event.type === "execution_failed"
    )?.createdAt ?? null;

    let durationMs: number | null = null;
    if (startedAt) {
        const startMs = new Date(startedAt).getTime();
        const endMs = endedAt ? new Date(endedAt).getTime() : Date.now();
        if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
            durationMs = Math.max(0, endMs - startMs);
        }
    }

    const approvalPending = !terminal && (
        fromLatest.approvalPending ?? events.some((event) => event.type === "waiting_for_approval")
    );

    return {
        phase: fromLatest.phase ?? events.at(-1)?.phase ?? null,
        activeTool: fromLatest.activeTool ?? null,
        retryStatus: terminal
            ? null
            : fromLatest.retryStatus ?? (events.some((event) => event.type === "retry_scheduled") ? "Retry scheduled" : null),
        approvalPending,
        verification: fromLatest.verification ?? events.some((event) => event.type === "verification"),
        progress: terminal && failedFromEvents ? 0 : fromLatest.progress ?? (typeof latest?.progress === "number" ? latest.progress : 0),
        durationMs,
        runId: fromLatest.runId ?? events.at(-1)?.runId ?? null,
        failureReason: fromLatest.failureReason
            ?? failedEventReason
            ?? (failedFromEvents ? "AI tools did not complete." : null),
        steps,
    };
}

export function useTaskExecution(taskId: string): TaskExecutionView {
    const events = useTaskStore((state) => state.executionEventsByTaskId[taskId] ?? EMPTY_EXECUTION_EVENTS);
    const latest = useTaskStore((state) => state.executionByTaskId[taskId]);

    return useMemo(() => deriveExecutionView(events, latest), [events, latest]);
}
