import type { TaskExecutionActionType, TaskUpdatedPayload } from "@semantask/types";
import { RetryManager } from "../retry-manager.js";
import { getLatestExecutionTaskAction as getLatestExecutionTaskActionFromRepo } from "@semantask/services/repositories/task.repo";
import * as taskModule from "@semantask/db/models/Task";
import ToolRegistry from "../tools/tool-registry.js";
import TaskSuccessRegistry, { createDefaultTaskSuccessRegistry } from "../task-success-registry.js";
import { CreateIssueTool } from "../tools/create-issue.tool.js";
import { ScheduleMeetingTool } from "../tools/schedule-meeting.tool.js";
import { SendEmailTool } from "../tools/send-email.tool.js";
import { createOrRefreshTaskPlan, getTaskPlan } from "../planner.js";
import { retrieveMemory } from "../memory-service.js";
import { generateAndStoreReflection } from "../reflection-service.js";
import { acquireTaskLease, heartbeatTaskLease, releaseTaskLease } from "../task-lease.js";
import { maybeLogTaskStateDivergence } from "../state-divergence-check.js";
import { assertTransition } from "../task-state-machine.js";
import { createInternalRequestHeaders } from "@semantask/types/utils/internal-bridge-auth";
import type {
    AcquireTaskLeaseFn,
    AssertTransitionFn,
    CreateOrRefreshTaskPlanFn,
    ExecutionUpdateEmitter,
    GenerateAndStoreReflectionFn,
    GetLatestExecutionTaskAction,
    GetTaskPlanFn,
    HeartbeatTaskLeaseFn,
    LlmRequestFn,
    ReleaseTaskLeaseFn,
    RetrieveMemoryFn,
    TaskDocumentLike,
    TaskModelLike,
    UpdatePlanStepStateFn,
    UpdateTaskPatch,
} from "./types.js";

export function resolveTaskModel(moduleNs: unknown): TaskModelLike {
    const asRecord = moduleNs as Record<string, unknown>;
    const candidates: unknown[] = [
        moduleNs,
        asRecord?.default,
        (asRecord?.default as Record<string, unknown> | undefined)?.default,
        asRecord?.TaskModel,
        (asRecord?.default as Record<string, unknown> | undefined)?.TaskModel,
    ];

    for (const candidate of candidates) {
        if (candidate && typeof (candidate as { findById?: unknown }).findById === "function") {
            return candidate as TaskModelLike;
        }
    }

    throw new Error(`Task model exports are invalid. keys=${Object.keys(asRecord || {}).join(",")}`);
}

export function resolveGetLatestExecutionTaskAction(
    moduleNs: unknown
): GetLatestExecutionTaskAction {
    const asRecord = moduleNs as Record<string, unknown>;
    const defaultExport = asRecord?.default as Record<string, unknown> | undefined;
    const candidates: unknown[] = [
        asRecord?.getLatestExecutionTaskAction,
        defaultExport?.getLatestExecutionTaskAction,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === "function") {
            return candidate as GetLatestExecutionTaskAction;
        }
    }

    throw new Error(`Task repository exports are invalid. keys=${Object.keys(asRecord || {}).join(",")}`);
}

export type AgentContextOptions = {
    retryManager?: RetryManager;
    taskModel?: TaskModelLike;
    toolRegistry?: ToolRegistry;
    taskSuccessRegistry?: TaskSuccessRegistry;
    internalBaseUrl?: string;
    getLatestExecutionTaskAction?: GetLatestExecutionTaskAction;
    persistentLoopEnabled?: boolean;
    workerId?: string;
    retrieveMemoryFn?: RetrieveMemoryFn;
    getTaskPlanFn?: GetTaskPlanFn;
    createOrRefreshTaskPlanFn?: CreateOrRefreshTaskPlanFn;
    generateAndStoreReflectionFn?: GenerateAndStoreReflectionFn;
    acquireTaskLeaseFn?: AcquireTaskLeaseFn;
    heartbeatTaskLeaseFn?: HeartbeatTaskLeaseFn;
    releaseTaskLeaseFn?: ReleaseTaskLeaseFn;
    assertTransitionFn?: AssertTransitionFn;
    updatePlanStepStateFn?: UpdatePlanStepStateFn;
    llmRequestFn?: LlmRequestFn;
    onExecutionUpdate?: ExecutionUpdateEmitter;
};

/**
 * Shared runtime context for the AgentRunner collaborators. Holds all injected
 * dependencies, mutable per-run state, and the small set of cross-cutting
 * primitives that multiple collaborators need (task persistence + eventing).
 */
export class AgentContext {
    readonly retryManager: RetryManager;
    readonly taskModel: TaskModelLike;
    readonly toolRegistry: ToolRegistry;
    readonly taskSuccessRegistry: TaskSuccessRegistry;
    readonly internalBaseUrl: string;
    readonly getLatestExecutionTaskAction: GetLatestExecutionTaskAction;
    readonly persistentLoopEnabled: boolean;
    readonly workerId: string;
    readonly retrieveMemoryFn: RetrieveMemoryFn;
    readonly getTaskPlanFn: GetTaskPlanFn;
    readonly createOrRefreshTaskPlanFn: CreateOrRefreshTaskPlanFn;
    readonly generateAndStoreReflectionFn: GenerateAndStoreReflectionFn;
    readonly acquireTaskLeaseFn: AcquireTaskLeaseFn;
    readonly heartbeatTaskLeaseFn: HeartbeatTaskLeaseFn;
    readonly releaseTaskLeaseFn: ReleaseTaskLeaseFn;
    readonly assertTransitionFn: AssertTransitionFn;
    readonly updatePlanStepStateFn?: UpdatePlanStepStateFn;
    readonly llmRequestFn?: LlmRequestFn;
    readonly onExecutionUpdate?: ExecutionUpdateEmitter;

    currentRunId: string | null = null;
    currentExecutionSignal: AbortSignal | null = null;
    currentUsageContext: {
        organizationId?: string | null;
        userId?: string | null;
        taskId?: string | null;
    } | null = null;

    constructor(options?: AgentContextOptions) {
        this.retryManager = options?.retryManager ?? new RetryManager([1000, 2000, 5000]);
        this.taskModel = options?.taskModel ?? resolveTaskModel(taskModule);
        this.toolRegistry = options?.toolRegistry ?? this.createDefaultToolRegistry();
        this.taskSuccessRegistry = options?.taskSuccessRegistry ?? createDefaultTaskSuccessRegistry();
        this.internalBaseUrl = options?.internalBaseUrl ?? process.env.SOCKET_SERVER_URL ?? process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3001";
        this.getLatestExecutionTaskAction = options?.getLatestExecutionTaskAction ?? getLatestExecutionTaskActionFromRepo;
        this.persistentLoopEnabled = options?.persistentLoopEnabled ?? (process.env.TASK_AGENT_PERSISTENT_LOOP_ENABLED === "true");
        this.workerId = options?.workerId ?? process.env.TASK_WORKER_ID ?? `${process.pid}-agent-runner`;
        this.retrieveMemoryFn = options?.retrieveMemoryFn ?? retrieveMemory;
        this.getTaskPlanFn = options?.getTaskPlanFn ?? getTaskPlan;
        this.createOrRefreshTaskPlanFn = options?.createOrRefreshTaskPlanFn ?? createOrRefreshTaskPlan;
        this.generateAndStoreReflectionFn = options?.generateAndStoreReflectionFn ?? generateAndStoreReflection;
        this.acquireTaskLeaseFn = options?.acquireTaskLeaseFn ?? acquireTaskLease;
        this.heartbeatTaskLeaseFn = options?.heartbeatTaskLeaseFn ?? heartbeatTaskLease;
        this.releaseTaskLeaseFn = options?.releaseTaskLeaseFn ?? releaseTaskLease;
        this.assertTransitionFn = options?.assertTransitionFn ?? assertTransition;
        this.updatePlanStepStateFn = options?.updatePlanStepStateFn;
        this.llmRequestFn = options?.llmRequestFn;
        this.onExecutionUpdate = options?.onExecutionUpdate;
    }

    private createDefaultToolRegistry() {
        const registry = new ToolRegistry();
        registry.register(new SendEmailTool());
        registry.register(new ScheduleMeetingTool());
        registry.register(new CreateIssueTool());
        return registry;
    }

    getCurrentRunId() {
        return this.currentRunId ?? `run-${Date.now()}`;
    }

    mapToolNameToActionType(toolName?: string | null): TaskExecutionActionType {
        if (!toolName) return "none";
        try {
            const tool = this.toolRegistry.get(toolName);
            if (tool) return toolName as TaskExecutionActionType;
        } catch {
            // ignore
        }
        return "none";
    }

    summarizeEvidence(evidence: unknown): unknown {
        if (evidence === null || evidence === undefined) return null;
        if (typeof evidence === "string") return evidence.length > 1000 ? `${evidence.slice(0, 1000)}...` : evidence;
        if (Array.isArray(evidence)) {
            return {
                type: "array",
                length: evidence.length,
                sample: evidence.length > 0 ? evidence[0] : null,
            };
        }
        if (typeof evidence === "object") {
            try {
                const asRecord = evidence as Record<string, unknown>;
                const keys = Object.keys(asRecord).slice(0, 5);
                const summary: Record<string, unknown> = {};
                for (const k of keys) summary[k] = asRecord[k];
                summary._keys = Object.keys(asRecord).length;
                return summary;
            } catch {
                return "[evidence]";
            }
        }
        return String(evidence).slice(0, 1000);
    }

    maybeCheckStateDivergence(task: TaskDocumentLike, source: string): void {
        maybeLogTaskStateDivergence({
            taskId: task._id.toString(),
            lifecycleState: task.lifecycleState,
            executionState: task.executionState,
            workerId: this.workerId,
            runId: this.currentRunId ?? undefined,
            source,
        });
    }

    async emitTaskUpdated(conversationId: string, payload: TaskUpdatedPayload) {
        await fetch(`${this.internalBaseUrl}/internal/task-updated`, {
            method: "POST",
            headers: createInternalRequestHeaders("socket"),
            body: JSON.stringify({
                conversationId,
                payload,
            }),
        });
    }

    async updateTask(task: TaskDocumentLike, patch: UpdateTaskPatch) {
        const previousVersion = task.version;
        let changed = false;

        if (patch.status !== undefined && task.status !== patch.status) {
            task.status = patch.status;
            changed = true;
        }
        if (patch.lifecycleState !== undefined && task.lifecycleState !== patch.lifecycleState) {
            task.lifecycleState = patch.lifecycleState;
            changed = true;
        }
        if (patch.retryCount !== undefined && task.retryCount !== patch.retryCount) {
            task.retryCount = patch.retryCount;
            changed = true;
        }
        if (patch.maxRetries !== undefined && task.maxRetries !== patch.maxRetries) {
            task.maxRetries = patch.maxRetries;
            changed = true;
        }
        if (patch.currentStepId !== undefined && task.currentStepId !== patch.currentStepId) {
            task.currentStepId = patch.currentStepId;
            changed = true;
        }
        if (patch.iterationCount !== undefined && task.iterationCount !== patch.iterationCount) {
            task.iterationCount = patch.iterationCount;
            changed = true;
        }
        if (patch.progress !== undefined && task.progress !== patch.progress) {
            task.progress = patch.progress;
            changed = true;
        }
        if (patch.checkpoints !== undefined && JSON.stringify(task.checkpoints ?? []) !== JSON.stringify(patch.checkpoints)) {
            task.checkpoints = patch.checkpoints;
            changed = true;
        }
        if (patch.executionHistory !== undefined && JSON.stringify(task.executionHistory ?? null) !== JSON.stringify(patch.executionHistory)) {
            task.executionHistory = patch.executionHistory;
            changed = true;
        }
        if (patch.result !== undefined && JSON.stringify(task.result ?? null) !== JSON.stringify(patch.result)) {
            task.result = patch.result;
            changed = true;
        }
        if (patch.pausedReason !== undefined && task.pausedReason !== patch.pausedReason) {
            task.pausedReason = patch.pausedReason;
            changed = true;
        }
        if (patch.blockedReason !== undefined && task.blockedReason !== patch.blockedReason) {
            task.blockedReason = patch.blockedReason;
            changed = true;
        }

        if (!changed) {
            return task;
        }

        task.updatedBy = null;
        await task.save();

        const payload: TaskUpdatedPayload = {
            taskId: task._id.toString(),
            conversationId: task.conversationId.toString(),
            patch: {
                ...(patch.status !== undefined ? { status: patch.status as any } : {}),
                ...(patch.lifecycleState !== undefined ? { lifecycleState: patch.lifecycleState as any } : {}),
                ...(patch.retryCount !== undefined ? { retryCount: patch.retryCount } : {}),
                ...(patch.maxRetries !== undefined ? { maxRetries: patch.maxRetries } : {}),
                ...(patch.currentStepId !== undefined ? { currentStepId: patch.currentStepId } : {}),
                ...(patch.iterationCount !== undefined ? { iterationCount: patch.iterationCount } : {}),
                ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
                ...(patch.checkpoints !== undefined ? { checkpoints: patch.checkpoints } : {}),
                ...(patch.executionHistory !== undefined ? { executionHistory: patch.executionHistory } : {}),
                ...(patch.result !== undefined ? { result: patch.result } : {}),
                ...(patch.pausedReason !== undefined ? { pausedReason: patch.pausedReason } : {}),
                ...(patch.blockedReason !== undefined ? { blockedReason: patch.blockedReason } : {}),
                updatedBy: null,
            },
            previousVersion,
            newVersion: task.version,
            updatedByType: "agent",
            updatedById: null,
        };

        await this.emitTaskUpdated(task.conversationId.toString(), payload);

        if (patch.lifecycleState !== undefined) {
            this.maybeCheckStateDivergence(task, "updateTask");
        }

        return task;
    }
}
