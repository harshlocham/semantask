import { Types } from "mongoose";
import { connectToDatabase } from "@semantask/db";
import TaskModel, { type ITask } from "@semantask/db/models/Task";
import type { ITaskAction } from "@semantask/db/models/TaskAction";
import { AuthorizationError } from "./authorization-errors";
import {
    assertCanDecideTaskExecutionApproval,
    type ConversationAccessOptions,
} from "./authorization.service";
import { ValidationError } from "./organization-errors";
import {
    getEffectiveExecutionMode,
    getOrganizationPolicy,
} from "./organization-policy.service";
import {
    buildTaskActionIdempotencyKey,
    createTaskAction,
    getInFlightExplicitRequestTaskAction,
} from "./repositories/task.repo";
import { enqueueTaskExecutionRequested } from "./task-execution-enqueue.service";

const toObjectId = (value: string) => new Types.ObjectId(value);

function isValidObjectId(value: string): boolean {
    return Types.ObjectId.isValid(value) && String(new Types.ObjectId(value)) === value;
}

export type RequestTaskExecutionInput = {
    taskId: string;
    actorUserId: string;
    reason?: string;
    authOptions?: ConversationAccessOptions;
};

export type RequestTaskExecutionResult = {
    taskAction: ITaskAction;
    enqueued: boolean;
    alreadyPending: boolean;
};

function serializeActionSummary(task: ITask, reason?: string): string {
    const base = "Explicit manager request to allow AI tool execution.";
    if (reason && reason.trim().length > 0) {
        return `${base} ${reason.trim()}`;
    }
    return `${base} Task: ${task.title}`;
}

/**
 * Explicit S2.4 path: request AI tool execution for an existing coordination Task.
 * Distinct from WorkSuggestion accept — never called by accept.
 */
export async function requestTaskExecution(
    input: RequestTaskExecutionInput
): Promise<RequestTaskExecutionResult> {
    if (!isValidObjectId(input.taskId) || !isValidObjectId(input.actorUserId)) {
        throw new ValidationError("taskId and actorUserId must be valid ObjectIds");
    }

    await connectToDatabase();

    const task = await TaskModel.findById(toObjectId(input.taskId)).exec();
    if (!task) {
        throw new AuthorizationError("NOT_FOUND", "Task not found");
    }

    const conversationId = task.conversationId.toString();
    const organizationId = task.organizationId ? task.organizationId.toString() : null;

    await assertCanDecideTaskExecutionApproval(
        input.actorUserId,
        { conversationId, organizationId },
        input.authOptions
    );

    const existingInFlight = await getInFlightExplicitRequestTaskAction(input.taskId);
    if (existingInFlight) {
        return {
            taskAction: existingInFlight,
            enqueued: false,
            alreadyPending: true,
        };
    }

    const orgPolicy = organizationId ? await getOrganizationPolicy(organizationId) : null;
    const executionMode = getEffectiveExecutionMode({
        organizationId,
        executionMode: orgPolicy?.executionMode ?? null,
    });

    const parameters: Record<string, unknown> = {
        titleHint: task.title,
        descriptionHint: task.description ?? "",
        content: [task.title, task.description]
            .filter((part) => typeof part === "string" && part.trim().length > 0)
            .join("\n\n"),
        source: "explicit-manager-request",
    };

    const triggerMessageId = task.sourceMessageIds?.[0]
        ? task.sourceMessageIds[0].toString()
        : input.taskId;

    let taskAction: ITaskAction;
    try {
        taskAction = await createTaskAction({
            taskId: input.taskId,
            conversationId,
            actorType: "user",
            actorId: input.actorUserId,
            actionType: "none",
            toolName: "none",
            messageId: task.sourceMessageIds?.[0] ? task.sourceMessageIds[0].toString() : null,
            parameters,
            executionState: "requested",
            summary: serializeActionSummary(task, input.reason),
            error: null,
            patch: {
                before: null,
                after: {
                    actionType: "none",
                    toolName: "none",
                    source: "explicit-manager-request",
                    explicitManagerRequest: true,
                    needsApproval: true,
                },
            },
            reason: input.reason?.trim() || "Manager requested AI tool execution",
            idempotencyKey: buildTaskActionIdempotencyKey(
                input.taskId,
                "requested:none",
                `explicit-${input.actorUserId}`
            ),
        });
    } catch (error) {
        const maybeMongoError = error as { code?: number };
        if (maybeMongoError?.code === 11000) {
            const racedInFlight = await getInFlightExplicitRequestTaskAction(input.taskId);
            if (racedInFlight) {
                return {
                    taskAction: racedInFlight,
                    enqueued: false,
                    alreadyPending: true,
                };
            }
        }
        throw error;
    }

    const enqueueResult = await enqueueTaskExecutionRequested({
        dedupeKey: `task.execution.requested:${input.taskId}:explicit:${input.actorUserId}`,
        executionMode,
        explicitManagerRequest: true,
        payload: {
            taskId: input.taskId,
            conversationId,
            triggerMessageId,
            requestedByType: "user",
            requestedById: input.actorUserId,
            actionType: "none",
            parameters,
            confidence: 1,
            needsApproval: true,
            explicitManagerRequest: true,
        },
    });

    if (organizationId) {
        void (async () => {
            try {
                const { notifyApprovalRequired } = await import("./notify-approval.service");
                await notifyApprovalRequired({
                    organizationId,
                    taskId: input.taskId,
                    actionId: taskAction._id.toString(),
                    title: task.title,
                    conversationId,
                    actorUserId: input.actorUserId,
                });
            } catch (error) {
                console.error("approval notify lookup failed", error);
            }
        })();
    }

    return {
        taskAction,
        enqueued: enqueueResult.enqueued,
        alreadyPending: false,
    };
}
