import mongoose from "mongoose";
import type {
    SuggestionConfidenceSignal,
    SuggestionExecutionPolicy,
    SuggestedWorkTool,
    TaskPriority,
    TaskRecord,
    WorkSuggestionCandidates,
    WorkSuggestionRecord,
    WorkSuggestionStatus,
} from "@semantask/types";
import { connectToDatabase } from "@semantask/db";
import TaskModel, { type ITask } from "@semantask/db/models/Task";
import WorkSuggestionModel, {
    type IWorkSuggestion,
    WORK_SUGGESTION_STATUSES,
} from "@semantask/db/models/WorkSuggestion";
import { AuthorizationError } from "./authorization-errors";
import { ConflictError, ValidationError } from "./organization-errors";
import {
    acceptToTaskLatencyMs,
    suggestionsAcceptedCounter,
    suggestionsDismissedCounter,
} from "@semantask/observability/metrics";
import { assertAcceptCreatesCoordinationOnly } from "./organization-policy.service";
import { assertUsersAreOrgMembers } from "./organization.service";
import { proposeExecutionFromSuggestion } from "./execution-proposal.service";
import { normalizeTask } from "./normalizers/task.normalizer";
import { createTask, updateTask } from "./repositories/task.repo";
import { enqueueOutboxEvent } from "./outbox.service";
import { resolveConversationLabels } from "./conversation-label.service";

export function isSuggestionStatus(value: unknown): value is WorkSuggestionStatus {
    return typeof value === "string"
        && (WORK_SUGGESTION_STATUSES as readonly string[]).includes(value);
}

export type CreateWorkSuggestionInput = {
    messageId: string;
    conversationId: string;
    organizationId?: string | null;
    intentId?: string | null;
    status?: WorkSuggestionStatus;
    title: string;
    summary?: string;
    requestedOutcome?: string | null;
    suggestedTool?: SuggestedWorkTool | null;
    executionPolicy?: SuggestionExecutionPolicy | null;
    confidenceSignals?: SuggestionConfidenceSignal[];
    possibleDuplicateTaskId?: string | null;
    confidence: number;
    candidates?: Partial<WorkSuggestionCandidates>;
    extractorVersion: string;
};

export type CreateWorkSuggestionResult = {
    suggestion: WorkSuggestionRecord;
    created: boolean;
};

export type ListWorkSuggestionsInput = {
    conversationId?: string;
    organizationId?: string;
    status?: WorkSuggestionStatus;
    page?: number;
    limit?: number;
};

export type WorkSuggestionListResult = {
    items: WorkSuggestionRecord[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
};

export type AcceptWorkSuggestionInput = {
    suggestionId: string;
    actorUserId: string;
    assignees?: string[];
    dueAt?: string | Date | null;
    priority?: TaskPriority;
};

export type AcceptWorkSuggestionResult = {
    suggestion: WorkSuggestionRecord;
    task: TaskRecord;
};

export type DismissWorkSuggestionInput = {
    suggestionId: string;
    actorUserId: string;
    reason: string;
};

export type AssignWorkSuggestionInput = {
    suggestionId: string;
    actorUserId: string;
    assignees?: string[];
    dueAt?: string | Date | null;
    priority?: TaskPriority;
};

export type AssignWorkSuggestionResult = {
    suggestion: WorkSuggestionRecord;
    task: TaskRecord;
};

const TASK_PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high", "urgent"];

function isTaskPriority(value: unknown): value is TaskPriority {
    return typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value);
}

function buildAcceptDedupeKey(suggestionId: string): string {
    return `suggestion.accept::${suggestionId}`;
}

function resolvePriority(
    override: TaskPriority | undefined,
    candidate: TaskPriority | "" | undefined
): TaskPriority {
    if (override && isTaskPriority(override)) {
        return override;
    }
    if (candidate && isTaskPriority(candidate)) {
        return candidate;
    }
    return "medium";
}

function resolveDueAt(
    override: string | Date | null | undefined,
    candidate: Date | string | null | undefined
): Date | null {
    if (override === null) {
        return null;
    }
    if (override !== undefined) {
        const parsed = override instanceof Date ? override : new Date(override);
        if (Number.isNaN(parsed.getTime())) {
            throw new ValidationError("Invalid dueAt");
        }
        return parsed;
    }
    if (candidate == null) {
        return null;
    }
    const parsed = candidate instanceof Date ? candidate : new Date(candidate);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveAssignees(
    override: string[] | undefined,
    candidates: mongoose.Types.ObjectId[] | undefined
): string[] {
    if (override !== undefined) {
        return override.filter((id) => isValidObjectId(id));
    }
    return (candidates ?? []).map((id) => id.toString()).filter((id) => isValidObjectId(id));
}

async function loadSuggestionOrThrow(suggestionId: string): Promise<IWorkSuggestion> {
    if (!isValidObjectId(suggestionId)) {
        throw new AuthorizationError("NOT_FOUND", "Work suggestion not found");
    }

    const doc = await WorkSuggestionModel.findById(suggestionId).exec();
    if (!doc) {
        throw new AuthorizationError("NOT_FOUND", "Work suggestion not found");
    }
    return doc;
}

async function findTaskByDedupeKey(dedupeKey: string): Promise<ITask | null> {
    return TaskModel.findOne({ dedupeKey }).exec();
}

async function createOrReuseAcceptTask(input: {
    suggestion: IWorkSuggestion;
    actorUserId: string;
    assignees: string[];
    dueAt: Date | null;
    priority: TaskPriority;
}): Promise<{ task: ITask; created: boolean }> {
    const suggestionId = input.suggestion._id.toString();
    const dedupeKey = buildAcceptDedupeKey(suggestionId);

    const existing = await findTaskByDedupeKey(dedupeKey);
    if (existing) {
        return { task: existing, created: false };
    }

    try {
        const task = await createTask({
            conversationId: input.suggestion.conversationId.toString(),
            organizationId: input.suggestion.organizationId
                ? input.suggestion.organizationId.toString()
                : null,
            parentTaskId: null,
            suggestionId,
            title: input.suggestion.title,
            description: input.suggestion.requestedOutcome || input.suggestion.summary || "",
            assignees: input.assignees,
            dueAt: input.dueAt,
            priority: input.priority,
            boardStatus: "todo",
            source: "ai",
            sourceMessageIds: [input.suggestion.messageId.toString()],
            latestContextMessageId: input.suggestion.messageId.toString(),
            confidence: input.suggestion.confidence,
            tags: ["work-suggestion"],
            dedupeKey,
            createdBy: input.actorUserId,
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
        return { task, created: true };
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            const raced = await findTaskByDedupeKey(dedupeKey);
            if (raced) {
                return { task: raced, created: false };
            }
        }
        throw error;
    }
}

async function enqueueTaskCreatedFanout(task: TaskRecord, actorUserId: string): Promise<void> {
    await enqueueOutboxEvent({
        topic: "task.created",
        dedupeKey: `task.created:${task._id}`,
        payload: {
            conversationId: task.conversationId,
            socketPath: "/internal/task-created",
            socketPayload: {
                task,
                sourceMessageId: task.sourceMessageIds[0] ?? null,
                createdByType: "user",
                createdById: actorUserId,
                suggestionId: task.suggestionId ?? null,
            },
        },
    });
}

async function enqueueSuggestionAcceptedOutbox(input: {
    suggestionId: string;
    taskId: string;
    conversationId: string;
    organizationId: string | null;
    actorUserId: string;
}): Promise<void> {
    await enqueueOutboxEvent({
        topic: "work.suggestion.accepted",
        dedupeKey: `work.suggestion.accepted:${input.suggestionId}`,
        payload: {
            suggestionId: input.suggestionId,
            taskId: input.taskId,
            conversationId: input.conversationId,
            organizationId: input.organizationId,
            actorUserId: input.actorUserId,
        },
    });
}

async function enqueueSuggestionDismissedOutbox(input: {
    suggestionId: string;
    conversationId: string;
    organizationId: string | null;
    actorUserId: string;
    dismissReason: string;
}): Promise<void> {
    await enqueueOutboxEvent({
        topic: "work.suggestion.dismissed",
        dedupeKey: `work.suggestion.dismissed:${input.suggestionId}`,
        payload: {
            suggestionId: input.suggestionId,
            conversationId: input.conversationId,
            organizationId: input.organizationId,
            actorUserId: input.actorUserId,
            dismissReason: input.dismissReason,
        },
    });
}

/**
 * Accept creates the coordination task before the suggestion CAS. If the CAS
 * loses (e.g. dismiss won), delete the orphan so the accept dedupe key does not
 * permanently block a later repair/re-accept.
 *
 * Skip delete when the suggestion already claims this task — a concurrent
 * winning accept may have linked it after we lost our CAS read.
 */
async function discardOrphanAcceptTask(
    task: ITask,
    suggestionId: string
): Promise<void> {
    const linked = await WorkSuggestionModel.findById(suggestionId).exec();
    if (
        linked?.status === "converted"
        && linked.convertedTaskId
        && linked.convertedTaskId.toString() === task._id.toString()
    ) {
        return;
    }

    const filter: { _id: ITask["_id"]; dedupeKey?: string } = { _id: task._id };
    if (typeof task.dedupeKey === "string" && task.dedupeKey.length > 0) {
        filter.dedupeKey = task.dedupeKey;
    }
    await TaskModel.deleteOne(filter).exec();
}

function isValidObjectId(value: string | null | undefined): value is string {
    return Boolean(value && mongoose.Types.ObjectId.isValid(value));
}

function isDuplicateKeyError(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && (error as { code?: number }).code === 11000);
}

export function normalizeWorkSuggestion(doc: IWorkSuggestion): WorkSuggestionRecord {
    return {
        _id: doc._id.toString(),
        messageId: doc.messageId.toString(),
        conversationId: doc.conversationId.toString(),
        organizationId: doc.organizationId ? doc.organizationId.toString() : null,
        intentId: doc.intentId ? doc.intentId.toString() : null,
        status: doc.status,
        title: doc.title,
        summary: doc.summary ?? "",
        confidence: doc.confidence,
        requestedOutcome: doc.requestedOutcome ?? null,
        suggestedTool: (doc.suggestedTool ?? null) as SuggestedWorkTool | null,
        executionPolicy: (doc.executionPolicy ?? null) as SuggestionExecutionPolicy | null,
        confidenceSignals: Array.isArray(doc.confidenceSignals)
            ? [...doc.confidenceSignals]
            : [],
        possibleDuplicateTaskId: doc.possibleDuplicateTaskId
            ? doc.possibleDuplicateTaskId.toString()
            : null,
        candidates: {
            assigneeCandidates: (doc.candidates?.assigneeCandidates ?? []).map((id) => id.toString()),
            dueAtCandidate: doc.candidates?.dueAtCandidate
                ? new Date(doc.candidates.dueAtCandidate).toISOString()
                : null,
            priorityCandidate: (doc.candidates?.priorityCandidate ?? "") as TaskPriority | "",
        },
        dismissReason: doc.dismissReason ?? null,
        convertedTaskId: doc.convertedTaskId ? doc.convertedTaskId.toString() : null,
        extractorVersion: doc.extractorVersion,
        createdAt: new Date(doc.createdAt).toISOString(),
        updatedAt: new Date(doc.updatedAt).toISOString(),
    };
}

async function findProposedByMessageId(messageId: string): Promise<IWorkSuggestion | null> {
    return WorkSuggestionModel.findOne({
        messageId: new mongoose.Types.ObjectId(messageId),
        status: "proposed",
    }).exec();
}

export async function createWorkSuggestion(
    input: CreateWorkSuggestionInput
): Promise<CreateWorkSuggestionResult> {
    await connectToDatabase();

    if (!isValidObjectId(input.messageId) || !isValidObjectId(input.conversationId)) {
        throw new ValidationError("Invalid messageId or conversationId");
    }

    if (
        input.organizationId != null
        && String(input.organizationId).trim() !== ""
        && !isValidObjectId(input.organizationId)
    ) {
        throw new ValidationError("Invalid organizationId");
    }

    if (
        input.intentId != null
        && String(input.intentId).trim() !== ""
        && !isValidObjectId(input.intentId)
    ) {
        throw new ValidationError("Invalid intentId");
    }

    if (!input.title || input.title.trim().length < 3) {
        throw new ValidationError("title must be at least 3 characters");
    }

    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
        throw new ValidationError("confidence must be between 0 and 1");
    }

    if (!input.extractorVersion?.trim()) {
        throw new ValidationError("extractorVersion is required");
    }

    const status: WorkSuggestionStatus = input.status ?? "proposed";
    if (!isSuggestionStatus(status)) {
        throw new ValidationError("Invalid status");
    }

    if (status === "proposed") {
        const existing = await findProposedByMessageId(input.messageId);
        if (existing) {
            return {
                suggestion: normalizeWorkSuggestion(existing),
                created: false,
            };
        }
    }

    const assigneeCandidates = (input.candidates?.assigneeCandidates ?? [])
        .filter((id) => isValidObjectId(id))
        .map((id) => new mongoose.Types.ObjectId(id));

    try {
        const doc = await WorkSuggestionModel.create({
            messageId: new mongoose.Types.ObjectId(input.messageId),
            conversationId: new mongoose.Types.ObjectId(input.conversationId),
            organizationId: isValidObjectId(input.organizationId)
                ? new mongoose.Types.ObjectId(input.organizationId)
                : null,
            intentId: isValidObjectId(input.intentId)
                ? new mongoose.Types.ObjectId(input.intentId)
                : null,
            status,
            title: input.title.trim().slice(0, 200),
            summary: (input.summary ?? "").slice(0, 4000),
            requestedOutcome: (input.requestedOutcome ?? "").trim().slice(0, 4000) || null,
            suggestedTool: input.suggestedTool ?? null,
            executionPolicy: input.executionPolicy ?? null,
            confidenceSignals: input.confidenceSignals ?? [],
            possibleDuplicateTaskId: isValidObjectId(input.possibleDuplicateTaskId)
                ? new mongoose.Types.ObjectId(input.possibleDuplicateTaskId)
                : null,
            confidence: Math.max(0, Math.min(1, input.confidence)),
            candidates: {
                assigneeCandidates,
                dueAtCandidate: input.candidates?.dueAtCandidate
                    ? new Date(input.candidates.dueAtCandidate)
                    : null,
                priorityCandidate: input.candidates?.priorityCandidate ?? "",
            },
            extractorVersion: input.extractorVersion.trim().slice(0, 64),
        });

        console.info(JSON.stringify({
            event: "suggestion.created",
            suggestionId: doc._id.toString(),
            messageId: input.messageId,
            conversationId: input.conversationId,
            organizationId: input.organizationId ?? null,
            status: doc.status,
            confidence: doc.confidence,
            extractorVersion: doc.extractorVersion,
        }));

        return {
            suggestion: normalizeWorkSuggestion(doc),
            created: true,
        };
    } catch (error) {
        if (status === "proposed" && isDuplicateKeyError(error)) {
            const raced = await findProposedByMessageId(input.messageId);
            if (raced) {
                return {
                    suggestion: normalizeWorkSuggestion(raced),
                    created: false,
                };
            }
        }
        throw error;
    }
}

export async function getWorkSuggestion(id: string): Promise<WorkSuggestionRecord | null> {
    if (!isValidObjectId(id)) {
        return null;
    }

    await connectToDatabase();

    const doc = await WorkSuggestionModel.findById(id).exec();
    if (!doc) {
        return null;
    }

    return normalizeWorkSuggestion(doc);
}

export async function listWorkSuggestions(
    input: ListWorkSuggestionsInput
): Promise<WorkSuggestionListResult> {
    await connectToDatabase();

    const conversationId = input.conversationId?.trim() || undefined;
    const organizationId = input.organizationId?.trim() || undefined;

    if (!conversationId && !organizationId) {
        throw new ValidationError("conversationId or organizationId is required");
    }

    if (conversationId && !isValidObjectId(conversationId)) {
        throw new ValidationError("Invalid conversationId");
    }

    if (organizationId && !isValidObjectId(organizationId)) {
        throw new ValidationError("Invalid organizationId");
    }

    if (input.status != null && !isSuggestionStatus(input.status)) {
        throw new ValidationError("Invalid status");
    }

    const page = Number.isFinite(input.page)
        ? Math.max(1, Math.trunc(Number(input.page)))
        : 1;
    const limit = Number.isFinite(input.limit)
        ? Math.min(100, Math.max(1, Math.trunc(Number(input.limit))))
        : 20;

    const query: Record<string, unknown> = {};
    if (conversationId) {
        query.conversationId = new mongoose.Types.ObjectId(conversationId);
    }
    if (organizationId) {
        query.organizationId = new mongoose.Types.ObjectId(organizationId);
    }
    if (input.status) {
        query.status = input.status;
    }

    const [total, rows] = await Promise.all([
        WorkSuggestionModel.countDocuments(query),
        WorkSuggestionModel.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .exec(),
    ]);

    const labels = await resolveConversationLabels(
        rows.map((row) => row.conversationId.toString())
    );

    return {
        items: rows.map((row) => {
            const record = normalizeWorkSuggestion(row);
            const conversationId = record.conversationId;
            return {
                ...record,
                conversationLabel: labels.get(conversationId) ?? null,
            };
        }),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        },
    };
}

/**
 * Accept a proposed WorkSuggestion into a coordination Task.
 * Never enqueues task.execution.* — may create an approval_pending proposal only.
 */
export async function acceptWorkSuggestion(
    input: AcceptWorkSuggestionInput
): Promise<AcceptWorkSuggestionResult> {
    assertAcceptCreatesCoordinationOnly();
    await connectToDatabase();

    if (!isValidObjectId(input.actorUserId)) {
        throw new ValidationError("Invalid actorUserId");
    }

    if (input.priority !== undefined && !isTaskPriority(input.priority)) {
        throw new ValidationError("Invalid priority");
    }

    if (input.assignees !== undefined) {
        if (!Array.isArray(input.assignees) || input.assignees.length > 32) {
            throw new ValidationError("assignees must be an array of at most 32 user ids");
        }
        for (const id of input.assignees) {
            if (!isValidObjectId(id)) {
                throw new ValidationError("Invalid assignee id");
            }
        }
    }

    const suggestion = await loadSuggestionOrThrow(input.suggestionId);

    if (suggestion.status === "converted" && suggestion.convertedTaskId) {
        const existingTask = await TaskModel.findById(suggestion.convertedTaskId).exec();
        if (!existingTask) {
            throw new ConflictError("Converted suggestion is missing its task");
        }
        await proposeExecutionFromSuggestion({
            task: existingTask,
            suggestion,
            actorUserId: input.actorUserId,
        });
        const taskRecord = normalizeTask(existingTask);
        // Idempotent retry may have committed conversion before outbox insert succeeded.
        await enqueueSuggestionAcceptedOutbox({
            suggestionId: suggestion._id.toString(),
            taskId: taskRecord._id,
            conversationId: suggestion.conversationId.toString(),
            organizationId: suggestion.organizationId
                ? suggestion.organizationId.toString()
                : null,
            actorUserId: input.actorUserId,
        });
        return {
            suggestion: normalizeWorkSuggestion(suggestion),
            task: taskRecord,
        };
    }

    if (suggestion.status !== "proposed") {
        throw new ConflictError(`Suggestion cannot be accepted from status=${suggestion.status}`);
    }

    const assignees = resolveAssignees(input.assignees, suggestion.candidates?.assigneeCandidates);
    const dueAt = resolveDueAt(input.dueAt, suggestion.candidates?.dueAtCandidate ?? null);
    const priority = resolvePriority(
        input.priority,
        (suggestion.candidates?.priorityCandidate ?? "") as TaskPriority | ""
    );

    if (assignees.length > 0 && suggestion.organizationId) {
        await assertUsersAreOrgMembers(suggestion.organizationId.toString(), assignees);
    }

    const { task, created: taskCreated } = await createOrReuseAcceptTask({
        suggestion,
        actorUserId: input.actorUserId,
        assignees,
        dueAt,
        priority,
    });

    const converted = await WorkSuggestionModel.findOneAndUpdate(
        {
            _id: suggestion._id,
            status: "proposed",
        },
        {
            $set: {
                status: "converted",
                convertedTaskId: task._id,
            },
        },
        { new: true }
    ).exec();

    if (converted) {
        const taskRecord = normalizeTask(task);
        const suggestionIdStr = converted._id.toString();
        const conversationIdStr = converted.conversationId.toString();
        const organizationIdStr = converted.organizationId
            ? converted.organizationId.toString()
            : null;

        console.info(JSON.stringify({
            event: "suggestion.converted",
            suggestionId: suggestionIdStr,
            taskId: taskRecord._id,
            actorUserId: input.actorUserId,
            conversationId: conversationIdStr,
            organizationId: organizationIdStr,
            taskCreated,
        }));

        await enqueueSuggestionAcceptedOutbox({
            suggestionId: suggestionIdStr,
            taskId: taskRecord._id,
            conversationId: conversationIdStr,
            organizationId: organizationIdStr,
            actorUserId: input.actorUserId,
        });

        if (taskCreated) {
            await enqueueTaskCreatedFanout(taskRecord, input.actorUserId);
            if (assignees.length > 0) {
                const { notifyUsers } = await import("./notify.service");
                const {
                    absoluteTaskHref,
                    withAbsoluteCta,
                    withAbsoluteCtaText,
                } = await import("./notify-links");
                const { escapeHtml } = await import("./html-escape");
                const taskLink = absoluteTaskHref(taskRecord._id);
                const text = `You were assigned "${taskRecord.title}".`;
                const html = `<p>You were assigned <b>${escapeHtml(taskRecord.title)}</b>.</p>`;
                void notifyUsers(
                    assignees.filter((id) => id !== input.actorUserId),
                    {
                        kind: "task_assigned",
                        subject: `Assigned: ${taskRecord.title}`,
                        text: withAbsoluteCtaText(text, taskLink, "Open task"),
                        html: withAbsoluteCta(html, taskLink, "Open task"),
                        dedupeKey: `assign:${taskRecord._id}:accept`,
                        conversationId: taskRecord.conversationId,
                        entityId: taskRecord._id,
                    }
                ).catch((error) => console.error("accept assign notify failed", error));
            }
        }

        await proposeExecutionFromSuggestion({
            task,
            suggestion: converted,
            actorUserId: input.actorUserId,
        });

        suggestionsAcceptedCounter.inc();
        const createdAtMs = suggestion.createdAt instanceof Date
            ? suggestion.createdAt.getTime()
            : Date.parse(String(suggestion.createdAt));
        if (Number.isFinite(createdAtMs)) {
            acceptToTaskLatencyMs.observe(Math.max(0, Date.now() - createdAtMs));
        }

        return {
            suggestion: normalizeWorkSuggestion(converted),
            task: taskRecord,
        };
    }

    const raced = await loadSuggestionOrThrow(input.suggestionId);
    if (
        raced.status === "converted"
        && raced.convertedTaskId
        && raced.convertedTaskId.toString() === task._id.toString()
    ) {
        const taskRecord = normalizeTask(task);
        await enqueueSuggestionAcceptedOutbox({
            suggestionId: raced._id.toString(),
            taskId: taskRecord._id,
            conversationId: raced.conversationId.toString(),
            organizationId: raced.organizationId
                ? raced.organizationId.toString()
                : null,
            actorUserId: input.actorUserId,
        });
        await proposeExecutionFromSuggestion({
            task,
            suggestion: raced,
            actorUserId: input.actorUserId,
        });
        return {
            suggestion: normalizeWorkSuggestion(raced),
            task: taskRecord,
        };
    }

    if (taskCreated) {
        await discardOrphanAcceptTask(task, input.suggestionId);
    }

    throw new ConflictError("Suggestion was modified concurrently; accept aborted");
}

export async function dismissWorkSuggestion(
    input: DismissWorkSuggestionInput
): Promise<WorkSuggestionRecord> {
    await connectToDatabase();

    if (!isValidObjectId(input.actorUserId)) {
        throw new ValidationError("Invalid actorUserId");
    }

    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!reason) {
        throw new ValidationError("dismiss reason is required");
    }
    if (reason.length > 2000) {
        throw new ValidationError("dismiss reason must be at most 2000 characters");
    }

    const suggestion = await loadSuggestionOrThrow(input.suggestionId);

    if (suggestion.status === "dismissed") {
        await enqueueSuggestionDismissedOutbox({
            suggestionId: suggestion._id.toString(),
            conversationId: suggestion.conversationId.toString(),
            organizationId: suggestion.organizationId
                ? suggestion.organizationId.toString()
                : null,
            actorUserId: input.actorUserId,
            dismissReason: suggestion.dismissReason ?? reason,
        });
        return normalizeWorkSuggestion(suggestion);
    }

    if (suggestion.status !== "proposed") {
        throw new ConflictError(`Suggestion cannot be dismissed from status=${suggestion.status}`);
    }

    const dismissed = await WorkSuggestionModel.findOneAndUpdate(
        {
            _id: suggestion._id,
            status: "proposed",
        },
        {
            $set: {
                status: "dismissed",
                dismissReason: reason.slice(0, 2000),
            },
        },
        { new: true }
    ).exec();

    if (dismissed) {
        const suggestionIdStr = dismissed._id.toString();
        const conversationIdStr = dismissed.conversationId.toString();
        const organizationIdStr = dismissed.organizationId
            ? dismissed.organizationId.toString()
            : null;

        console.info(JSON.stringify({
            event: "suggestion.dismissed",
            suggestionId: suggestionIdStr,
            actorUserId: input.actorUserId,
            conversationId: conversationIdStr,
            organizationId: organizationIdStr,
        }));

        await enqueueSuggestionDismissedOutbox({
            suggestionId: suggestionIdStr,
            conversationId: conversationIdStr,
            organizationId: organizationIdStr,
            actorUserId: input.actorUserId,
            dismissReason: reason.slice(0, 2000),
        });

        suggestionsDismissedCounter.inc();
        return normalizeWorkSuggestion(dismissed);
    }

    const raced = await loadSuggestionOrThrow(input.suggestionId);
    if (raced.status === "dismissed") {
        await enqueueSuggestionDismissedOutbox({
            suggestionId: raced._id.toString(),
            conversationId: raced.conversationId.toString(),
            organizationId: raced.organizationId
                ? raced.organizationId.toString()
                : null,
            actorUserId: input.actorUserId,
            dismissReason: raced.dismissReason ?? reason,
        });
        return normalizeWorkSuggestion(raced);
    }

    throw new ConflictError("Suggestion was modified concurrently; dismiss aborted");
}

export async function assignWorkSuggestion(
    input: AssignWorkSuggestionInput
): Promise<AssignWorkSuggestionResult> {
    await connectToDatabase();

    if (!isValidObjectId(input.actorUserId)) {
        throw new ValidationError("Invalid actorUserId");
    }

    if (
        input.assignees === undefined
        && input.dueAt === undefined
        && input.priority === undefined
    ) {
        throw new ValidationError("assignees, dueAt, or priority is required");
    }

    if (input.priority !== undefined && !isTaskPriority(input.priority)) {
        throw new ValidationError("Invalid priority");
    }

    if (input.assignees !== undefined) {
        if (!Array.isArray(input.assignees) || input.assignees.length > 32) {
            throw new ValidationError("assignees must be an array of at most 32 user ids");
        }
        for (const id of input.assignees) {
            if (!isValidObjectId(id)) {
                throw new ValidationError("Invalid assignee id");
            }
        }
    }

    const suggestion = await loadSuggestionOrThrow(input.suggestionId);

    if (suggestion.status !== "converted" || !suggestion.convertedTaskId) {
        throw new ConflictError("Suggestion must be converted before assign");
    }

    if (input.assignees !== undefined && suggestion.organizationId) {
        await assertUsersAreOrgMembers(
            suggestion.organizationId.toString(),
            input.assignees
        );
    }

    const dueAt = input.dueAt !== undefined
        ? resolveDueAt(input.dueAt, undefined)
        : undefined;

    const updatedTask = await updateTask({
        taskId: suggestion.convertedTaskId.toString(),
        ...(input.assignees !== undefined ? { assignees: input.assignees } : {}),
        ...(dueAt !== undefined ? { dueAt } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        updatedBy: input.actorUserId,
    });

    if (!updatedTask) {
        throw new ConflictError("Converted suggestion is missing its task");
    }

    const taskRecord = normalizeTask(updatedTask);

    await enqueueOutboxEvent({
        topic: "task.updated",
        dedupeKey: `task.updated:${taskRecord._id}:${taskRecord.updatedAt}`,
        payload: {
            conversationId: taskRecord.conversationId,
            socketPath: "/internal/task-updated",
            socketPayload: {
                taskId: taskRecord._id,
                conversationId: taskRecord.conversationId,
                patch: {
                    ...(input.assignees !== undefined ? { assignees: input.assignees } : {}),
                    ...(dueAt !== undefined ? { dueAt: dueAt ? dueAt.toISOString() : null } : {}),
                    ...(input.priority !== undefined ? { priority: input.priority } : {}),
                },
                previousVersion: Math.max(0, (taskRecord.version ?? 1) - 1),
                newVersion: taskRecord.version,
                updatedByType: "user",
                updatedById: input.actorUserId,
                suggestionId: suggestion._id.toString(),
            },
        },
    });

    if (input.assignees !== undefined && input.assignees.length > 0) {
        const { notifyUsers } = await import("./notify.service");
        const {
            absoluteTaskHref,
            withAbsoluteCta,
            withAbsoluteCtaText,
        } = await import("./notify-links");
        const { escapeHtml } = await import("./html-escape");
        const taskLink = absoluteTaskHref(taskRecord._id);
        const text = `You were assigned "${taskRecord.title}".`;
        const html = `<p>You were assigned <b>${escapeHtml(taskRecord.title)}</b>.</p>`;
        void notifyUsers(
            input.assignees.filter((id) => id !== input.actorUserId),
            {
                kind: "task_assigned",
                subject: `Assigned: ${taskRecord.title}`,
                text: withAbsoluteCtaText(text, taskLink, "Open task"),
                html: withAbsoluteCta(html, taskLink, "Open task"),
                dedupeKey: `assign:${taskRecord._id}:${taskRecord.updatedAt}`,
                conversationId: taskRecord.conversationId,
                entityId: taskRecord._id,
            }
        ).catch((error) => console.error("assign notify failed", error));
    }

    console.info(JSON.stringify({
        event: "suggestion.assigned",
        suggestionId: suggestion._id.toString(),
        taskId: taskRecord._id,
        actorUserId: input.actorUserId,
        conversationId: suggestion.conversationId.toString(),
        organizationId: suggestion.organizationId
            ? suggestion.organizationId.toString()
            : null,
    }));

    return {
        suggestion: normalizeWorkSuggestion(suggestion),
        task: taskRecord,
    };
}

export { WORK_SUGGESTION_STATUSES };
