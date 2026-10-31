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
import {
    classifyMessage,
    isActionableClassification,
} from "./message-classifier.service.js";
import { upsertMessageIntent, type ParticipantHint } from "./message-intent.service.js";
import { createWorkSuggestion } from "./work-suggestion.service.js";
import {
    distillWorkSuggestion,
    normalizeWorkTitleKey,
    resolveSuggestionExecutionPolicy,
} from "./work-suggestion-extract.js";
import {
    getEffectiveExecutionMode,
    resolveOrganizationPolicy,
    shouldBlockExecutionEnqueue,
} from "./organization-policy.service.js";
import { enqueueTaskExecutionRequested } from "./task-execution-enqueue.service.js";
import { normalizeTask } from "./normalizers/task.normalizer";
import {
    suggestionLatencyMs,
    suggestionsCreatedCounter,
} from "@semantask/observability/metrics";

export const AI_VERSION = "intelligent-v8-work-semantics";

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

function preprocessMessage(
    content: string,
    actionVerb = "",
    dueAtCandidate: Date | string | null = null,
    objectText?: string
) {
    const distilled = distillWorkSuggestion({
        content,
        actionVerb,
        objectText,
        dueAtCandidate,
    });
    return {
        normalized: normalizeContent(content),
        title: distilled.title,
        description: distilled.summary,
        requestedOutcome: distilled.requestedOutcome,
        suggestedTool: distilled.suggestedTool,
        confidenceSignals: distilled.confidenceSignals,
        titleKey: distilled.titleKey,
    };
}

async function findPossibleDuplicateTask(input: {
    conversationId: string;
    title: string;
}): Promise<string | null> {
    const titleKey = normalizeWorkTitleKey(input.title);
    if (!titleKey) return null;

    const openTasks = await TaskModel.find({
        conversationId: input.conversationId,
        cancelRequestedAt: null,
        lifecycleState: { $nin: ["completed", "failed"] },
        boardStatus: { $ne: "done" },
    })
        .select("_id title")
        .sort({ updatedAt: -1 })
        .limit(50)
        .lean();

    const match = (openTasks ?? []).find(
        (task) => normalizeWorkTitleKey(String(task.title ?? "")) === titleKey
    );
    return match?._id ? match._id.toString() : null;
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
    return {
        orgPolicy,
        executionMode: getEffectiveExecutionMode({
            organizationId,
            executionMode: orgPolicy?.executionMode ?? null,
        }),
    };
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
    const normalizedContent = normalizeContent(input.content);
    const conversationContext = await loadConversationContext(input.conversationId);

    if (!normalizedContent) {
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

    // Throws if the LLM fails. Nothing is written yet, so the outbox event stays retryable.
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
    const { orgPolicy, executionMode } = await resolveEffectiveModeForConversation(organizationId);
    const blockExecution = shouldBlockExecutionEnqueue(executionMode);

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

    const preprocessed = preprocessMessage(
        input.content,
        intent.entities.actionVerb,
        intent.entities.dueAtCandidate,
        intent.entities.objectText
    );
    const possibleDuplicateTaskId = await findPossibleDuplicateTask({
        conversationId: input.conversationId,
        title: preprocessed.title,
    });
    const executionPolicy = resolveSuggestionExecutionPolicy({
        tool: preprocessed.suggestedTool,
        toolDenyList: orgPolicy?.toolDenyList,
        requireApprovalFor: orgPolicy?.requireApprovalFor,
        executionMode,
    });

    const { created } = await createWorkSuggestion({
        messageId: input.messageId,
        conversationId: input.conversationId,
        organizationId,
        intentId: intent._id,
        title: preprocessed.title,
        summary: preprocessed.description,
        requestedOutcome: preprocessed.requestedOutcome,
        suggestedTool: preprocessed.suggestedTool,
        executionPolicy,
        confidenceSignals: preprocessed.confidenceSignals,
        possibleDuplicateTaskId,
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
        boardStatus: "todo",
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

    await enqueueTaskExecutionRequested({
        dedupeKey: executionDedupeKey,
        payload: executionPayload,
        executionMode,
    });

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
                task: normalizeTask(task),
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
