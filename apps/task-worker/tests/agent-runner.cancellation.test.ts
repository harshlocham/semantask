import "./test-env.js";
import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { AgentRunner } from "../services/agent-runner.js";
import ToolRegistry, { type Tool } from "../services/tools/tool-registry.js";

type MockTask = {
    _id: { toString(): string };
    conversationId: { toString(): string };
    title: string;
    description: string;
    status: string;
    lifecycleState?: string;
    version: number;
    updatedBy: null | string;
    retryCount?: number;
    maxRetries?: number;
    progress?: number;
    cancelRequestedAt?: Date | null;
    cancelReason?: string | null;
    cancelRequestedByType?: "user" | "agent" | "system" | null;
    executionState?: unknown;
    stateHistory?: unknown[];
    result?: Record<string, unknown>;
    save: () => Promise<void>;
};

class RecordingTool implements Tool {
    public readonly name: string;
    public readonly description: string;
    public readonly inputSchema = z.object({}).passthrough();
    public readonly calls: Array<{ toolName: string; input: Record<string, unknown> }> = [];

    constructor(name: string) {
        this.name = name;
        this.description = `${name} tool`;
    }

    async execute(input: Record<string, unknown>) {
        this.calls.push({ toolName: this.name, input });
        return {
            summary: `${this.name} executed`,
            adapterSuccess: true,
            evidence: { ok: true },
        };
    }
}

function createMockTask(overrides?: Partial<MockTask>): MockTask {
    const task: MockTask = {
        _id: { toString: () => "task-cancel-1" },
        conversationId: { toString: () => "conv-cancel-1" },
        title: "send welcome email to user@example.com",
        description: "Send welcome email",
        status: "pending",
        lifecycleState: "ready",
        version: 1,
        updatedBy: null,
        retryCount: 0,
        maxRetries: 2,
        save: async () => {
            task.version += 1;
        },
        ...overrides,
    };

    return task;
}

function sendEmailDecision() {
    return {
        output_text: JSON.stringify({
            tool: "send_email",
            confidence: 1,
            parameters: {
                to: "user@example.com",
                subject: "Welcome",
                body: "Hello",
            },
            reasoning: "Send welcome email.",
            noAction: false,
            needsClarification: false,
            clarificationQuestion: "",
        }),
    };
}

function restoreEnvVar(key: string, value: string | undefined) {
    if (value === undefined) {
        delete process.env[key];
        return;
    }

    process.env[key] = value;
}

function withMockedFetch(fn: () => Promise<void>) {
    const originalFetch = global.fetch;

    global.fetch = (async () => new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    return fn().finally(() => {
        global.fetch = originalFetch;
    });
}

test("cancellation gate after LLM prevents tool side effects", async () => {
    const task = createMockTask();
    const sendEmailTool = new RecordingTool("send_email");
    const registry = new ToolRegistry();
    registry.register(sendEmailTool);

    let llmCompleted = false;

    const runner = new AgentRunner({
        llmRequestFn: async () => {
            llmCompleted = true;
            return sendEmailDecision();
        },
        taskModel: {
            findById: async () => {
                if (llmCompleted) {
                    return {
                        ...task,
                        cancelRequestedAt: new Date("2026-07-06T07:24:56.000Z"),
                        cancelReason: "Cancelled by user.",
                        cancelRequestedByType: "user" as const,
                    };
                }

                return task;
            },
        },
        toolRegistry: registry,
        taskSuccessRegistry: {
            validate: () => ({
                validator: "cancel-test",
                passed: true,
                checks: [],
            }),
        } as never,
        internalBaseUrl: "http://mock-internal",
        getLatestExecutionTaskAction: async () => ({
            taskId: { toString: () => "task-cancel-1" },
            conversationId: { toString: () => "conv-cancel-1" },
            actionType: "send_email",
            toolName: "send_email",
            parameters: {},
            messageId: null,
            executionState: null,
        }),
    });

    const previousMaxIterations = process.env.TASK_AGENT_MAX_ITERATIONS;
    process.env.TASK_AGENT_MAX_ITERATIONS = "2";

    await withMockedFetch(async () => {
        const outcome = await runner.runTask("task-cancel-1");

        assert.equal(sendEmailTool.calls.length, 0);
        assert.equal(outcome.completed, false);
        assert.equal(outcome.result?.error, "Cancelled by user.");
        assert.equal(outcome.result?.summary, "Task cancelled.");
    });

    restoreEnvVar("TASK_AGENT_MAX_ITERATIONS", previousMaxIterations);
});

test("cancel watcher aborts in-flight LLM before tool execution", async () => {
    const task = createMockTask();
    const sendEmailTool = new RecordingTool("send_email");
    const registry = new ToolRegistry();
    registry.register(sendEmailTool);

    let llmStarted = false;

    const runner = new AgentRunner({
        llmRequestFn: async () => {
            llmStarted = true;
            await new Promise((resolve) => setTimeout(resolve, 400));
            return sendEmailDecision();
        },
        taskModel: {
            findById: async () => {
                if (llmStarted && !task.cancelRequestedAt) {
                    task.cancelRequestedAt = new Date("2026-07-06T07:24:56.000Z");
                    task.cancelReason = "Cancelled by user.";
                    task.cancelRequestedByType = "user";
                }

                return task;
            },
        },
        toolRegistry: registry,
        taskSuccessRegistry: {
            validate: () => ({
                validator: "cancel-test",
                passed: true,
                checks: [],
            }),
        } as never,
        internalBaseUrl: "http://mock-internal",
        getLatestExecutionTaskAction: async () => ({
            taskId: { toString: () => "task-cancel-1" },
            conversationId: { toString: () => "conv-cancel-1" },
            actionType: "send_email",
            toolName: "send_email",
            parameters: {},
            messageId: null,
            executionState: null,
        }),
    });

    const previousMaxIterations = process.env.TASK_AGENT_MAX_ITERATIONS;
    const previousCancelPoll = process.env.TASK_CANCEL_POLL_MS;
    process.env.TASK_AGENT_MAX_ITERATIONS = "2";
    process.env.TASK_CANCEL_POLL_MS = "50";

    await withMockedFetch(async () => {
        const outcome = await runner.runTask("task-cancel-1");

        assert.equal(sendEmailTool.calls.length, 0);
        assert.equal(outcome.completed, false);
        assert.equal(outcome.result?.error, "Cancelled by user.");
    });

    restoreEnvVar("TASK_AGENT_MAX_ITERATIONS", previousMaxIterations);
    restoreEnvVar("TASK_CANCEL_POLL_MS", previousCancelPoll);
});
