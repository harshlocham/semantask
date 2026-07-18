import type { ExecutionState, TaskCheckpoint, TaskExecutionActionType, TaskExecutionHistory, TaskExecutionUpdatedPayload, TaskResult, TaskValidationLog } from "@semantask/types";
import type { retrieveMemory } from "../memory-service.js";
import type { getTaskPlan, createOrRefreshTaskPlan } from "../planner.js";
import type { generateAndStoreReflection } from "../reflection-service.js";
import type { acquireTaskLease, heartbeatTaskLease, releaseTaskLease } from "../task-lease.js";
import type { assertTransition } from "../task-state-machine.js";
import type { ShadowExecutionStateHistoryEntry } from "../execution-state-shadow.js";

export type TaskModelLike = {
    findById: (id: string) => Promise<TaskDocumentLike | null>;
};

export type ExecutionActionRecord = {
    taskId: string;
    conversationId: string;
    toolName: string;
    parameters: Record<string, unknown>;
    messageId: string | null;
    executionState: string | null;
    stepId?: string | null;
    attempt?: number;
    idempotencyKey?: string | null;
};

export type TaskDocumentLike = {
    _id: { toString(): string };
    conversationId: { toString(): string };
    organizationId?: { toString(): string } | null;
    createdBy?: { toString(): string } | string | null;
    parentTaskId?: { toString(): string } | null;
    lifecycleState?: "planning" | "ready" | "executing" | "waiting_for_approval" | "blocked" | "retry_scheduled" | "paused" | "completed" | "failed";
    sourceMessageIds?: Array<{ toString(): string }>;
    title: string;
    description: string;
    status: string;
    subTasks?: Array<{ toString(): string }>;
    dependencyIds?: Array<{ toString(): string }>;
    retryCount?: number;
    maxRetries?: number;
    currentStepId?: string | null;
    iterationCount?: number;
    leaseOwner?: string | null;
    leaseExpiresAt?: Date | null;
    blockedReason?: string | null;
    pausedReason?: string | null;
    progress?: number;
    checkpoints?: TaskCheckpoint[];
    executionHistory?: TaskExecutionHistory;
    result?: TaskResult;
    cancelRequestedAt?: Date | null;
    cancelReason?: string | null;
    cancelRequestedByType?: "user" | "agent" | "system" | null;
    executionState?: ExecutionState | Record<string, unknown> | null;
    stateHistory?: ShadowExecutionStateHistoryEntry[];
    version: number;
    updatedBy: null | string;
    save: () => Promise<void>;
};

export type ActionExecutionResult = {
    summary: string;
    adapterSuccess: boolean;
    evidence: unknown;
    error?: string;
};

export type ExecutionOptions = {
    userId?: string | null;
    organizationId?: string | null;
    clarificationReply?: string | null;
    pendingResolution?: import("../entity-resolution.service.js").PendingResolution | null;
    participantEmails?: string[];
    contactEmails?: string[];
};

export type VerificationOutcome = {
    success: boolean;
    confidence: number;
    validationLog?: TaskValidationLog;
};

export type AvailableToolForDecision = {
    name: string;
    description: string;
    inputSchema: unknown;
};

export type NextActionDecision = {
    toolName: string | null;
    confidence: number;
    toolInput: Record<string, unknown>;
    reasoning?: string;
    goalAchieved?: boolean;
    noAction?: boolean;
    needsClarification?: boolean;
    clarificationQuestion?: string;
};

export type IterationContextEntry = {
    iteration: number;
    decision: {
        toolName: string | null;
        reasoning?: string;
        noAction?: boolean;
        needsClarification?: boolean;
    };
    result?: {
        summary: string;
        adapterSuccess: boolean;
        error?: string;
    };
};

export type RequestedToolName = "send_email" | "create_github_issue" | "schedule_meeting";

export type LoopContext = {
    task: TaskDocumentLike;
    action: ExecutionActionRecord;
    retryCount: number;
    maxRetries: number;
    attemptPayload: ExecutionActionRecord;
    observed: ActionExecutionResult | null;
    verification: VerificationOutcome | null;
};

export type RunTaskOutcome = {
    completed: boolean;
    retryCount: number;
    maxRetries: number;
    result: ActionExecutionResult | null;
    verification: VerificationOutcome | null;
};

export type RunTaskContext = {
    runId?: string;
    workerId?: string;
    leaseHeld?: boolean;
    abortSignal?: AbortSignal;
    clarificationReply?: string | null;
};

export type ExecutionUpdateEmitter = (payload: TaskExecutionUpdatedPayload) => Promise<void> | void;

export type PlanStepLike = {
    stepId: string;
    title: string;
    description: string;
    kind: "tool_call" | "decision" | "approval" | "notification" | "validation";
    state: "ready" | "running" | "waiting_for_dependency" | "waiting_for_approval" | "retry_scheduled" | "blocked" | "completed" | "failed" | "skipped";
    order: number;
    dependencies: string[];
    fallbackPolicy: "dependency_preserving" | "immediate_execution";
    overrideDependencies: boolean;
    fallback: Array<{ stepId: string; reason: string }>;
    successCriteria: string[];
    toolCandidates: Array<{ toolName: string; confidence: number; riskLevel: "low" | "medium" | "high" }>;
    selectedToolName?: string | null;
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
    attempts: number;
    maxAttempts: number;
    lastError?: string | null;
    startedAt?: Date | string | null;
    completedAt?: Date | string | null;
};

export type TaskPlanLike = {
    taskId: { toString(): string };
    status: "draft" | "approved" | "active" | "completed" | "failed" | "cancelled";
    steps: PlanStepLike[];
    activeStepId?: string | null;
};

export type RetrieveMemoryFn = typeof retrieveMemory;
export type GetTaskPlanFn = typeof getTaskPlan;
export type CreateOrRefreshTaskPlanFn = typeof createOrRefreshTaskPlan;
export type GenerateAndStoreReflectionFn = typeof generateAndStoreReflection;
export type AcquireTaskLeaseFn = typeof acquireTaskLease;
export type HeartbeatTaskLeaseFn = typeof heartbeatTaskLease;
export type ReleaseTaskLeaseFn = typeof releaseTaskLease;
export type AssertTransitionFn = typeof assertTransition;
export type UpdatePlanStepStateFn = (taskId: string, stepId: string, patch: Partial<PlanStepLike>) => Promise<void>;

export type LlmRequestFn = (request: { model: string; input: string }) => Promise<{ output_text?: string; output?: unknown }>;

export type LatestExecutionTaskAction = {
    taskId: { toString(): string };
    conversationId: { toString(): string };
    actionType: string;
    toolName?: string | null;
    parameters?: Record<string, unknown> | null;
    messageId?: { toString(): string } | null;
    executionState?: string | null;
};

export type GetLatestExecutionTaskAction = (taskId: string) => Promise<LatestExecutionTaskAction | null>;

export type ExecutionHistoryDelta = {
    attempts?: number;
    failures?: number;
    appendResult?: {
        attempt: number;
        success: boolean;
        summary: string;
        error?: string;
        validationLog?: TaskValidationLog;
    };
};

export type UpdateTaskPatch = {
    status?: string;
    lifecycleState?: "planning" | "ready" | "executing" | "waiting_for_approval" | "blocked" | "retry_scheduled" | "paused" | "completed" | "failed";
    retryCount?: number;
    maxRetries?: number;
    currentStepId?: string | null;
    iterationCount?: number;
    progress?: number;
    checkpoints?: TaskCheckpoint[];
    executionHistory?: TaskExecutionHistory;
    result?: TaskResult;
    pausedReason?: string | null;
    blockedReason?: string | null;
};

export function wait(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export function waitForSignal(ms: number, signal?: AbortSignal) {
    if (!signal) {
        return wait(ms);
    }

    return new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
            reject(new Error("Execution aborted."));
            return;
        }

        const handle = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);

        const onAbort = () => {
            cleanup();
            reject(new Error("Execution aborted."));
        };

        const cleanup = () => {
            clearTimeout(handle);
            signal.removeEventListener("abort", onAbort);
        };

        signal.addEventListener("abort", onAbort, { once: true });
    });
}

export function combineAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
    const activeSignals = signals.filter(Boolean) as AbortSignal[];
    if (activeSignals.length === 0) {
        return undefined;
    }

    if (typeof AbortSignal.any === "function") {
        return AbortSignal.any(activeSignals);
    }

    const controller = new AbortController();
    const listeners: Array<{ signal: AbortSignal; onAbort: () => void }> = [];

    const cleanup = () => {
        for (const { signal, onAbort } of listeners) {
            signal.removeEventListener("abort", onAbort);
        }
        listeners.length = 0;
    };

    for (const signal of activeSignals) {
        if (signal.aborted) {
            cleanup();
            controller.abort();
            return controller.signal;
        }
        const onAbort = () => {
            cleanup();
            if (!controller.signal.aborted) {
                controller.abort();
            }
        };
        signal.addEventListener("abort", onAbort, { once: true });
        listeners.push({ signal, onAbort });
    }

    return controller.signal;
}
