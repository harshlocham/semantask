import {
    type MessageSemanticUpdatedPayload,
    type TaskCreatedPayload,
    type TaskLinkedToMessagePayload,
    type TaskUpdatedPayload,
} from "@semantask/types";
import MessageModel from "@semantask/db/models/Message";
import TaskModel from "@semantask/db/models/Task";
import { Conversation } from "@semantask/db/models/Conversation";
import { User } from "@semantask/db/models/User";
import {
    buildTaskActionIdempotencyKey,
    createTaskAction,
    deriveTaskDedupeKey,
    linkMessageToTask,
    upsertTaskByDedupeKey,
    updateMessageSemanticState,
} from "./repositories/task.repo";
import { connectToDatabase } from "@semantask/db";
import { enqueueOutboxEvent } from "./outbox.service";
import {
    classifyMessage,
    isActionableClassification,
} from "./message-classifier.service.js";
import { upsertMessageIntent, type ParticipantHint } from "./message-intent.service.js";
import { createWorkSuggestion } from "./work-suggestion.service.js";
import {
    getEffectiveExecutionMode,
    isSuggestionIngressEnabled,
    resolveOrganizationPolicy,
    shouldBlockExecutionEnqueue,
} from "./organization-policy.service.js";
import { enqueueTaskExecutionRequested } from "./task-execution-enqueue.service.js";
import {
    suggestionLatencyMs,
    suggestionsCreatedCounter,
} from "@semantask/observability/metrics";

export const AI_VERSION = "intelligent-v7-entity-heuristics";

export interface ProcessMessageTaskIntelligenceInput {
    messageId: string;
    conversationId: string;
    senderId: string;
    content: string;
    messageType: string;
}

export interface ProcessMessageTaskIntelligenceResult {
    semanticPayload: MessageSemanticUpdatedPayload;
    taskCreatedPayload?: TaskCreatedPayload;
    taskUpdatedPayload?: TaskUpdatedPayload;
    taskLinkedPayload?: TaskLinkedToMessagePayload;
}

function normalizeContent(content: string) {
    return content.trim().replace(/\s+/g, " ");
}

function toTaskTitle(content: string) {
    const normalized = normalizeContent(content);
    if (!normalized) return "Follow up";

    const withoutPrefix = normalized.replace(/^(@\w+[:,]?\s*)+/, "");
    const trimmed = withoutPrefix.slice(0, 200);
    return trimmed.length >= 3 ? trimmed : normalized.slice(0, 200);
}

function buildTaskDescription(content: string) {
    const normalized = normalizeContent(content);
    if (!normalized) {
        return "No additional context was provided.";
    }

    return `Requested outcome: ${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function preprocessMessage(content: string) {
    const normalized = normalizeContent(content);
    return {
        normalized,
        title: toTaskTitle(normalized),
        description: buildTaskDescription(normalized),
    };
}

async function loadConversationContext(conversationId: string): Promise<{
    organizationId: string | null;
    participants: ParticipantHint[];
}> {
    const conversation = await Conversation.findById(conversationId)
        .select("organizationId participants")
        .lean();

    if (!conversation) {
        return { organizationId: null, participants: [] };
    }

    const organizationId = conversation.organizationId
        ? conversation.organizationId.toString()
        : null;

    const participantIds = (conversation.participants ?? [])
        .map((id) => id?.toString?.() ?? String(id))
        .filter(Boolean);

    if (participantIds.length === 0) {
        return { organizationId, participants: [] };
    }

    const users = await User.find({ _id: { $in: participantIds } })
        .select("_id username email")
        .lean();

    const participants: ParticipantHint[] = users.map((user) => ({
        userId: user._id.toString(),
        username: typeof user.username === "string" ? user.username : null,
        email: typeof user.email === "string" ? user.email : null,
    }));

    return { organizationId, participants };
}

async function resolveEffectiveModeForConversation(organizationId: string | null) {
    const orgPolicy = organizationId
        ? await resolveOrganizationPolicy(organizationId)
        : null;
    return getEffectiveExecutionMode({
        organizationId,
        executionMode: orgPolicy?.executionMode ?? null,
    });
}

export async function processMessageTaskIntelligence(
    input: ProcessMessageTaskIntelligenceInput
): Promise<ProcessMessageTaskIntelligenceResult | null> {
    if (input.messageType !== "text") {
        return null;
    }

    const startedAt = Date.now();
    await connectToDatabase();

    const existing = await MessageModel.findById(input.messageId).select(
        "_id conversationId manualOverride semanticProcessedAt aiStatus linkedTaskIds"
    );

    if (!existing || existing.manualOverride) {
        return null;
    }

    if (existing.semanticProcessedAt && existing.aiStatus === "classified") {
        return null;
    }

    const processedAt = new Date();
    const preprocessed = preprocessMessage(input.content);
    const conversationContext = await loadConversationContext(input.conversationId);

    if (!preprocessed.normalized) {
        await updateMessageSemanticState(input.messageId, {
            semanticType: "chat",
            semanticConfidence: 0,
            aiStatus: "classified",
            aiVersion: AI_VERSION,
            linkedTaskIds: [],
            semanticProcessedAt: processedAt,
        });

        await upsertMessageIntent({
            messageId: input.messageId,
            conversationId: input.conversationId,
            semanticType: "chat",
            content: "",
            confidence: 0,
            rawSummary: "Empty message content",
            extractorVersion: AI_VERSION,
            participants: conversationContext.participants,
        });

        return {
            semanticPayload: {
                messageId: input.messageId,
                conversationId: input.conversationId,
                semanticType: "chat",
                semanticConfidence: 0,
                aiStatus: "classified",
                aiVersion: AI_VERSION,
                linkedTaskIds: [],
                semanticProcessedAt: processedAt.toISOString(),
            },
        };
    }

    const classification = await classifyMessage(input.content);
    const semanticType = classification.semanticType;

    if (!isActionableClassification(classification)) {
        await updateMessageSemanticState(input.messageId, {
            semanticType,
            semanticConfidence: classification.confidence,
            aiStatus: "classified",
            aiVersion: AI_VERSION,
            linkedTaskIds: [],
            semanticProcessedAt: processedAt,
        });

        await upsertMessageIntent({
            messageId: input.messageId,
            conversationId: input.conversationId,
            semanticType,
            content: input.content,
            confidence: classification.confidence,
            rawSummary: classification.reasoning,
            extractorVersion: AI_VERSION,
            participants: conversationContext.participants,
        });

        return {
            semanticPayload: {
                messageId: input.messageId,
                conversationId: input.conversationId,
                semanticType,
                semanticConfidence: classification.confidence,
                aiStatus: "classified",
                aiVersion: AI_VERSION,
                linkedTaskIds: [],
                semanticProcessedAt: processedAt.toISOString(),
            },
        };
    }

    const organizationId = conversationContext.organizationId;
    const executionMode = await resolveEffectiveModeForConversation(organizationId);
    const suggestionIngress = isSuggestionIngressEnabled();
    const blockExecution = suggestionIngress && shouldBlockExecutionEnqueue(executionMode);

    const intent = await upsertMessageIntent({
        messageId: input.messageId,
        conversationId: input.conversationId,
        semanticType,
        content: input.content,
        confidence: classification.confidence,
        rawSummary: classification.reasoning,
        extractorVersion: AI_VERSION,
        participants: conversationContext.participants,
    });

    if (suggestionIngress) {
        const { created } = await createWorkSuggestion({
            messageId: input.messageId,
            conversationId: input.conversationId,
            organizationId,
            intentId: intent._id,
            title: preprocessed.title,
            summary: preprocessed.description,
            confidence: classification.confidence,
            extractorVersion: AI_VERSION,
            candidates: {
                assigneeCandidates: intent.entities.assigneeUserIds,
                dueAtCandidate: intent.entities.dueAtCandidate,
                priorityCandidate: intent.entities.priorityCandidate,
            },
        });

        suggestionLatencyMs.observe(Date.now() - startedAt);
        if (created) {
            suggestionsCreatedCounter.inc();
        }
    }

    if (blockExecution) {
        await updateMessageSemanticState(input.messageId, {
            semanticType,
            semanticConfidence: classification.confidence,
            aiStatus: "classified",
            aiVersion: AI_VERSION,
            linkedTaskIds: [],
            semanticProcessedAt: processedAt,
        });

        return {
            semanticPayload: {
                messageId: input.messageId,
                conversationId: input.conversationId,
                semanticType,
                semanticConfidence: classification.confidence,
                aiStatus: "classified",
                aiVersion: AI_VERSION,
                linkedTaskIds: [],
                semanticProcessedAt: processedAt.toISOString(),
            },
        };
    }

    // Legacy / non-blocked path: create task and request execution
    const dedupeKey = deriveTaskDedupeKey({
        conversationId: input.conversationId,
        title: preprocessed.title,
        sourceMessageId: input.messageId,
        toolName: "none",
        parameters: {
            messageId: input.messageId,
            content: preprocessed.normalized,
            titleHint: preprocessed.title,
            descriptionHint: preprocessed.description,
        },
    });

    const preExistingTask = await TaskModel.findOne({ dedupeKey }).select("_id version").lean();

    const task = await upsertTaskByDedupeKey({
        conversationId: input.conversationId,
        parentTaskId: null,
        title: preprocessed.title,
        description: preprocessed.description,
        assignees: [],
        dueAt: null,
        priority: "medium",
        source: "ai",
        sourceMessageIds: [input.messageId],
        latestContextMessageId: input.messageId,
        confidence: classification.confidence,
        tags: ["preprocessed"],
        dedupeKey,
        createdBy: input.senderId,
        subTasks: [],
        dependencyIds: [],
        lifecycleState: "ready",
        iterationCount: 0,
        currentRunId: null,
        currentStepId: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        nextRetryAt: null,
        blockedReason: null,
        pausedReason: null,
        progress: 0,
        checkpoints: [],
        executionHistory: {
            attempts: 0,
            failures: 0,
            results: [],
        },
    });

    await linkMessageToTask({
        taskId: task._id.toString(),
        messageId: input.messageId,
        conversationId: input.conversationId,
        linkType: "source",
        idempotencyKey: `link::${input.messageId}::${task._id.toString()}`,
        semanticType,
    });

    await updateMessageSemanticState(input.messageId, {
        semanticType,
        semanticConfidence: classification.confidence,
        aiStatus: "classified",
        aiVersion: AI_VERSION,
        linkedTaskIds: [task._id.toString()],
        semanticProcessedAt: processedAt,
    });

    const executionPayload = {
        taskId: task._id.toString(),
        conversationId: input.conversationId,
        triggerMessageId: input.messageId,
        requestedByType: "agent",
        requestedById: null,
        actionType: "none",
        parameters: {
            messageId: input.messageId,
            content: preprocessed.normalized,
            titleHint: preprocessed.title,
            descriptionHint: preprocessed.description,
            semanticType,
        },
        confidence: classification.confidence,
        needsApproval: false,
        semanticType,
    };

    const executionDedupeKey =
        `task.execution.requested:${task._id.toString()}:${input.messageId}:none`;

    if (suggestionIngress) {
        // Guarded boundary: classifier bugs cannot enqueue under suggest_only+block
        await enqueueTaskExecutionRequested({
            dedupeKey: executionDedupeKey,
            payload: executionPayload,
            executionMode,
        });
    } else {
        // Preserve legacy behavior when SUGGESTION_INGRESS=0
        await enqueueOutboxEvent({
            topic: "task.execution.requested",
            dedupeKey: executionDedupeKey,
            payload: executionPayload,
        });
    }

    try {
        await createTaskAction({
            taskId: task._id.toString(),
            conversationId: input.conversationId,
            actorType: "agent",
            actorId: null,
            actionType: "none",
            toolName: "none",
            messageId: input.messageId,
            parameters: {
                messageId: input.messageId,
                content: preprocessed.normalized,
                titleHint: preprocessed.title,
                descriptionHint: preprocessed.description,
            },
            executionState: "requested",
            summary: "Autonomous execution requested from preprocessed message context.",
            error: null,
            patch: {
                before: null,
                after: {
                    actionType: "none",
                    toolName: "none",
                    source: "task-intelligence-preprocess",
                },
            },
            reason: "Preprocessed task delegated to autonomous agent runner",
            idempotencyKey: buildTaskActionIdempotencyKey(
                task._id.toString(),
                "requested:none",
                input.messageId
            ),
        });
    } catch (error) {
        const maybeMongoError = error as { code?: number };
        if (maybeMongoError?.code !== 11000) {
            throw error;
        }
    }

    try {
        await createTaskAction({
            taskId: task._id.toString(),
            conversationId: input.conversationId,
            actorType: "agent",
            actorId: null,
            actionType: preExistingTask ? "linked_message" : "created",
            messageId: input.messageId,
            patch: {
                before: preExistingTask ? { latestContextMessageId: null } : null,
                after: { latestContextMessageId: input.messageId },
            },
            reason: "Message preprocessing linked message to task",
            idempotencyKey: buildTaskActionIdempotencyKey(
                task._id.toString(),
                preExistingTask ? "linked_message" : "created",
                input.messageId
            ),
        });
    } catch (error) {
        const maybeMongoError = error as { code?: number };
        if (maybeMongoError?.code !== 11000) {
            throw error;
        }
    }

    const semanticPayload: MessageSemanticUpdatedPayload = {
        messageId: input.messageId,
        conversationId: input.conversationId,
        semanticType,
        semanticConfidence: classification.confidence,
        aiStatus: "classified",
        aiVersion: AI_VERSION,
        linkedTaskIds: [task._id.toString()],
        semanticProcessedAt: processedAt.toISOString(),
    };

    const taskLinkedPayload: TaskLinkedToMessagePayload = {
        taskId: task._id.toString(),
        messageId: input.messageId,
        conversationId: input.conversationId,
        linkType: "source",
        taskVersion: task.version,
    };

    if (!preExistingTask) {
        return {
            semanticPayload,
            taskLinkedPayload,
            taskCreatedPayload: {
                task: {
                    _id: task._id.toString(),
                    conversationId: task.conversationId.toString(),
                    parentTaskId: task.parentTaskId ? task.parentTaskId.toString() : null,
                    title: task.title,
                    description: task.description,
                    status: task.status,
                    priority: task.priority,
                    assignees: task.assignees.map((assignee) => assignee.toString()),
                    dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null,
                    createdBy: task.createdBy.toString(),
                    source: task.source,
                    sourceMessageIds: task.sourceMessageIds.map((sourceMessageId) => sourceMessageId.toString()),
                    latestContextMessageId: task.latestContextMessageId
                        ? task.latestContextMessageId.toString()
                        : null,
                    confidence: task.confidence,
                    tags: task.tags,
                    dedupeKey: task.dedupeKey,
                    subTasks: (task.subTasks ?? []).map((subTaskId) => subTaskId.toString()),
                    dependencyIds: (task.dependencyIds ?? []).map((dependencyId) => dependencyId.toString()),
                    retryCount: typeof task.retryCount === "number" ? task.retryCount : 0,
                    maxRetries: typeof task.maxRetries === "number" ? task.maxRetries : 2,
                    progress: typeof task.progress === "number" ? task.progress : 0,
                    checkpoints: (task.checkpoints ?? []).map((checkpoint) => ({
                        step: checkpoint.step,
                        status: checkpoint.status,
                        timestamp: new Date(checkpoint.timestamp).toISOString(),
                    })),
                    executionHistory: {
                        attempts: typeof task.executionHistory?.attempts === "number" ? task.executionHistory.attempts : 0,
                        failures: typeof task.executionHistory?.failures === "number" ? task.executionHistory.failures : 0,
                        results: (task.executionHistory?.results ?? []).map((entry) => ({
                            attempt: entry.attempt,
                            success: entry.success,
                            summary: entry.summary,
                            ...(typeof entry.error === "string" && entry.error.length > 0 ? { error: entry.error } : {}),
                            timestamp: new Date(entry.timestamp).toISOString(),
                        })),
                    },
                    result: {
                        success: Boolean(task.result?.success),
                        confidence: typeof task.result?.confidence === "number" ? task.result.confidence : 0,
                        evidence: task.result?.evidence ?? null,
                        ...(typeof task.result?.error === "string" && task.result.error.length > 0
                            ? { error: task.result.error }
                            : {}),
                    },
                    version: task.version,
                    closedAt: task.closedAt ? new Date(task.closedAt).toISOString() : null,
                    archivedAt: task.archivedAt ? new Date(task.archivedAt).toISOString() : null,
                    updatedBy: task.updatedBy ? task.updatedBy.toString() : null,
                    createdAt: new Date(task.createdAt).toISOString(),
                    updatedAt: new Date(task.updatedAt).toISOString(),
                },
                sourceMessageId: input.messageId,
                createdByType: "agent",
            },
        };
    }

    return {
        semanticPayload,
        taskLinkedPayload,
        taskUpdatedPayload: {
            taskId: task._id.toString(),
            conversationId: input.conversationId,
            patch: {
                latestContextMessageId: input.messageId,
                updatedBy: null,
            },
            previousVersion: preExistingTask.version,
            newVersion: task.version,
            updatedByType: "agent",
            updatedById: null,
        },
    };
}
