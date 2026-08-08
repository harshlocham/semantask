import { Types } from "mongoose";
import { beforeEach, describe, expect, it } from "@jest/globals";

jest.mock("@semantask/db", () => ({
    connectToDatabase: jest.fn().mockResolvedValue(undefined),
}));

const messageFindById = jest.fn();
jest.mock("@semantask/db/models/Message", () => ({
    __esModule: true,
    default: {
        findById: (...args: unknown[]) => messageFindById(...args),
    },
}));

const taskFindOne = jest.fn();
jest.mock("@semantask/db/models/Task", () => ({
    __esModule: true,
    default: {
        findOne: (...args: unknown[]) => taskFindOne(...args),
    },
}));

const conversationFindById = jest.fn();
jest.mock("@semantask/db/models/Conversation", () => ({
    Conversation: {
        findById: (...args: unknown[]) => conversationFindById(...args),
    },
}));

const userFind = jest.fn();
jest.mock("@semantask/db/models/User", () => ({
    User: {
        find: (...args: unknown[]) => userFind(...args),
    },
}));

const updateMessageSemanticState = jest.fn();
const upsertTaskByDedupeKey = jest.fn();
const linkMessageToTask = jest.fn();
const createTaskAction = jest.fn();
const deriveTaskDedupeKey = jest.fn();
const buildTaskActionIdempotencyKey = jest.fn();

jest.mock("../repositories/task.repo", () => ({
    updateMessageSemanticState: (...args: unknown[]) => updateMessageSemanticState(...args),
    upsertTaskByDedupeKey: (...args: unknown[]) => upsertTaskByDedupeKey(...args),
    linkMessageToTask: (...args: unknown[]) => linkMessageToTask(...args),
    createTaskAction: (...args: unknown[]) => createTaskAction(...args),
    deriveTaskDedupeKey: (...args: unknown[]) => deriveTaskDedupeKey(...args),
    buildTaskActionIdempotencyKey: (...args: unknown[]) => buildTaskActionIdempotencyKey(...args),
}));

const enqueueOutboxEvent = jest.fn();
jest.mock("../outbox.service", () => ({
    enqueueOutboxEvent: (...args: unknown[]) => enqueueOutboxEvent(...args),
}));

const upsertMessageIntent = jest.fn();
jest.mock("../message-intent.service", () => ({
    upsertMessageIntent: (...args: unknown[]) => upsertMessageIntent(...args),
}));

const createWorkSuggestion = jest.fn();
jest.mock("../work-suggestion.service", () => ({
    createWorkSuggestion: (...args: unknown[]) => createWorkSuggestion(...args),
}));

const resolveOrganizationPolicy = jest.fn();
const getEffectiveExecutionMode = jest.fn();
const isSuggestionIngressEnabled = jest.fn();
const shouldBlockExecutionEnqueue = jest.fn();

jest.mock("../organization-policy.service", () => ({
    resolveOrganizationPolicy: (...args: unknown[]) => resolveOrganizationPolicy(...args),
    getEffectiveExecutionMode: (...args: unknown[]) => getEffectiveExecutionMode(...args),
    isSuggestionIngressEnabled: (...args: unknown[]) => isSuggestionIngressEnabled(...args),
    shouldBlockExecutionEnqueue: (...args: unknown[]) => shouldBlockExecutionEnqueue(...args),
}));

const enqueueTaskExecutionRequested = jest.fn();
jest.mock("../task-execution-enqueue.service", () => ({
    enqueueTaskExecutionRequested: (...args: unknown[]) => enqueueTaskExecutionRequested(...args),
}));

const suggestionsCreatedCounter = { inc: jest.fn() };
const suggestionLatencyMs = { observe: jest.fn() };
jest.mock("@semantask/observability/metrics", () => ({
    suggestionsCreatedCounter,
    suggestionLatencyMs,
}));

const classifyMessage = jest.fn();
const isActionableClassification = jest.fn();
jest.mock("../message-classifier.service", () => ({
    classifyMessage: (...args: unknown[]) => classifyMessage(...args),
    isActionableClassification: (...args: unknown[]) => isActionableClassification(...args),
}));

import { processMessageTaskIntelligence } from "../task-intelligence.service";

const messageId = new Types.ObjectId().toString();
const conversationId = new Types.ObjectId().toString();
const senderId = new Types.ObjectId().toString();
const intentId = new Types.ObjectId().toString();
const organizationId = new Types.ObjectId().toString();
const taskId = new Types.ObjectId().toString();

const actionableInput = {
    messageId,
    conversationId,
    senderId,
    content: "send a welcome email to the team",
    messageType: "text",
};

function mockUnclassifiedMessage() {
    messageFindById.mockReturnValue({
        select: jest.fn().mockResolvedValue({
            _id: messageId,
            conversationId,
            manualOverride: false,
            semanticProcessedAt: null,
            aiStatus: "pending",
            linkedTaskIds: [],
        }),
    });
}

function mockConversation(orgId: string | null = organizationId) {
    conversationFindById.mockReturnValue({
        select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue({
                organizationId: orgId ? new Types.ObjectId(orgId) : null,
                participants: [],
            }),
        }),
    });
    userFind.mockReturnValue({
        select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
        }),
    });
}

function mockActionableClassify() {
    classifyMessage.mockResolvedValue({
        semanticType: "task",
        confidence: 0.9,
        reasoning: "actionable task",
        source: "regex",
    });
    isActionableClassification.mockReturnValue(true);
}

function mockIntent() {
    upsertMessageIntent.mockResolvedValue({
        _id: intentId,
        messageId,
        conversationId,
        intentType: "request",
        entities: {
            actionVerb: "send",
            objectText: "welcome email",
            assigneeUserIds: [],
            dueAtCandidate: null,
            priorityCandidate: "",
        },
        confidence: 0.9,
        extractorVersion: "intelligent-v7-entity-heuristics",
        rawSummary: "actionable task",
        createdAt: new Date().toISOString(),
    });
}

function mockTaskUpsert() {
    deriveTaskDedupeKey.mockReturnValue("dedupe-key");
    taskFindOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(null),
        }),
    });
    const now = new Date();
    upsertTaskByDedupeKey.mockResolvedValue({
        _id: new Types.ObjectId(taskId),
        conversationId: new Types.ObjectId(conversationId),
        parentTaskId: null,
        title: "send a welcome email to the team",
        description: "Requested outcome: Send a welcome email to the team",
        status: "open",
        priority: "medium",
        assignees: [],
        dueAt: null,
        createdBy: new Types.ObjectId(senderId),
        source: "ai",
        sourceMessageIds: [new Types.ObjectId(messageId)],
        latestContextMessageId: new Types.ObjectId(messageId),
        confidence: 0.9,
        tags: ["preprocessed"],
        dedupeKey: "dedupe-key",
        subTasks: [],
        dependencyIds: [],
        retryCount: 0,
        maxRetries: 2,
        progress: 0,
        checkpoints: [],
        executionHistory: { attempts: 0, failures: 0, results: [] },
        result: { success: false, confidence: 0, evidence: null },
        version: 1,
        closedAt: null,
        archivedAt: null,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
    });
    linkMessageToTask.mockResolvedValue(undefined);
    createTaskAction.mockResolvedValue(undefined);
    buildTaskActionIdempotencyKey.mockReturnValue("idem");
    updateMessageSemanticState.mockResolvedValue(undefined);
}

beforeEach(() => {
    messageFindById.mockReset();
    taskFindOne.mockReset();
    conversationFindById.mockReset();
    userFind.mockReset();
    updateMessageSemanticState.mockReset();
    upsertTaskByDedupeKey.mockReset();
    linkMessageToTask.mockReset();
    createTaskAction.mockReset();
    deriveTaskDedupeKey.mockReset();
    buildTaskActionIdempotencyKey.mockReset();
    enqueueOutboxEvent.mockReset();
    upsertMessageIntent.mockReset();
    createWorkSuggestion.mockReset();
    resolveOrganizationPolicy.mockReset();
    getEffectiveExecutionMode.mockReset();
    isSuggestionIngressEnabled.mockReset();
    shouldBlockExecutionEnqueue.mockReset();
    enqueueTaskExecutionRequested.mockReset();
    classifyMessage.mockReset();
    isActionableClassification.mockReset();
    suggestionsCreatedCounter.inc.mockReset();
    suggestionLatencyMs.observe.mockReset();

    mockUnclassifiedMessage();
    mockConversation();
    mockActionableClassify();
    mockIntent();
    mockTaskUpsert();
    resolveOrganizationPolicy.mockResolvedValue({ executionMode: "suggest_only" });
    getEffectiveExecutionMode.mockReturnValue("suggest_only");
    isSuggestionIngressEnabled.mockReturnValue(false);
    shouldBlockExecutionEnqueue.mockReturnValue(false);
    createWorkSuggestion.mockResolvedValue({
        suggestion: { _id: new Types.ObjectId().toString() },
        created: true,
    });
    enqueueTaskExecutionRequested.mockResolvedValue({ enqueued: true, blocked: false });
    enqueueOutboxEvent.mockResolvedValue({});
});

describe("processMessageTaskIntelligence suggest-only ingress", () => {
    it("ingress on + suggest_only: MessageIntent + WorkSuggestion, zero execution enqueue, no Task", async () => {
        isSuggestionIngressEnabled.mockReturnValue(true);
        shouldBlockExecutionEnqueue.mockReturnValue(true);

        const result = await processMessageTaskIntelligence(actionableInput);

        expect(upsertMessageIntent).toHaveBeenCalledWith(
            expect.objectContaining({
                messageId,
                conversationId,
                semanticType: "task",
                extractorVersion: "intelligent-v7-entity-heuristics",
            })
        );
        expect(createWorkSuggestion).toHaveBeenCalledWith(
            expect.objectContaining({
                messageId,
                conversationId,
                organizationId,
                intentId,
                confidence: 0.9,
                extractorVersion: "intelligent-v7-entity-heuristics",
            })
        );
        expect(suggestionsCreatedCounter.inc).toHaveBeenCalledTimes(1);
        expect(suggestionLatencyMs.observe).toHaveBeenCalled();
        expect(upsertTaskByDedupeKey).not.toHaveBeenCalled();
        expect(enqueueOutboxEvent).not.toHaveBeenCalled();
        expect(enqueueTaskExecutionRequested).not.toHaveBeenCalled();
        expect(result?.taskCreatedPayload).toBeUndefined();
        expect(result?.semanticPayload.linkedTaskIds).toEqual([]);
    });

    it("duplicate delivery / retry is idempotent for suggestions and keeps zero execution", async () => {
        isSuggestionIngressEnabled.mockReturnValue(true);
        shouldBlockExecutionEnqueue.mockReturnValue(true);
        createWorkSuggestion
            .mockResolvedValueOnce({
                suggestion: { _id: "s1" },
                created: true,
            })
            .mockResolvedValueOnce({
                suggestion: { _id: "s1" },
                created: false,
            });

        await processMessageTaskIntelligence(actionableInput);

        // Simulate worker retry before classified mark sticks: still unclassified
        mockUnclassifiedMessage();
        await processMessageTaskIntelligence(actionableInput);

        expect(createWorkSuggestion).toHaveBeenCalledTimes(2);
        expect(suggestionsCreatedCounter.inc).toHaveBeenCalledTimes(1);
        expect(enqueueTaskExecutionRequested).not.toHaveBeenCalled();
        expect(enqueueOutboxEvent).not.toHaveBeenCalled();
        expect(upsertTaskByDedupeKey).not.toHaveBeenCalled();
    });

    it("ingress disabled preserves legacy Task + raw outbox enqueue", async () => {
        isSuggestionIngressEnabled.mockReturnValue(false);
        shouldBlockExecutionEnqueue.mockReturnValue(true); // would block if guarded path used

        const result = await processMessageTaskIntelligence(actionableInput);

        expect(createWorkSuggestion).not.toHaveBeenCalled();
        expect(upsertMessageIntent).toHaveBeenCalled();
        expect(upsertTaskByDedupeKey).toHaveBeenCalled();
        expect(enqueueOutboxEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                topic: "task.execution.requested",
            })
        );
        expect(enqueueTaskExecutionRequested).not.toHaveBeenCalled();
        expect(result?.taskCreatedPayload).toBeDefined();
    });

    it("ingress on + auto_execute: suggestion + guarded enqueue allowed", async () => {
        isSuggestionIngressEnabled.mockReturnValue(true);
        getEffectiveExecutionMode.mockReturnValue("auto_execute");
        shouldBlockExecutionEnqueue.mockReturnValue(false);

        const result = await processMessageTaskIntelligence(actionableInput);

        expect(createWorkSuggestion).toHaveBeenCalled();
        expect(upsertTaskByDedupeKey).toHaveBeenCalled();
        expect(enqueueTaskExecutionRequested).toHaveBeenCalledWith(
            expect.objectContaining({
                executionMode: "auto_execute",
                payload: expect.objectContaining({
                    requestedByType: "agent",
                    taskId: taskId,
                }),
            })
        );
        expect(enqueueOutboxEvent).not.toHaveBeenCalled();
        expect(result?.taskCreatedPayload).toBeDefined();
    });

    it("ingress on + require_approval: suggestion + guarded enqueue allowed", async () => {
        isSuggestionIngressEnabled.mockReturnValue(true);
        getEffectiveExecutionMode.mockReturnValue("require_approval");
        shouldBlockExecutionEnqueue.mockReturnValue(false);

        await processMessageTaskIntelligence(actionableInput);

        expect(createWorkSuggestion).toHaveBeenCalled();
        expect(enqueueTaskExecutionRequested).toHaveBeenCalledWith(
            expect.objectContaining({ executionMode: "require_approval" })
        );
        expect(enqueueOutboxEvent).not.toHaveBeenCalled();
    });

    it("already classified messages short-circuit (worker retry after success)", async () => {
        messageFindById.mockReturnValue({
            select: jest.fn().mockResolvedValue({
                _id: messageId,
                conversationId,
                manualOverride: false,
                semanticProcessedAt: new Date(),
                aiStatus: "classified",
                linkedTaskIds: [],
            }),
        });
        isSuggestionIngressEnabled.mockReturnValue(true);

        const result = await processMessageTaskIntelligence(actionableInput);

        expect(result).toBeNull();
        expect(classifyMessage).not.toHaveBeenCalled();
        expect(createWorkSuggestion).not.toHaveBeenCalled();
        expect(enqueueOutboxEvent).not.toHaveBeenCalled();
    });
});
