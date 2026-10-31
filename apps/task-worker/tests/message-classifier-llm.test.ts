import "./test-env.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
    ClassifierUnavailableError,
    classifyMessage,
    configureMessageClassifier,
} from "@semantask/services/message-classifier.service";
import { classifyMessageWithLlm } from "../services/message-classifier-llm.js";
import { OpenAIProvider } from "../services/llm/providers/openai-provider.js";
import { LLMError, type LLMResponse } from "../services/llm/types.js";
import { RetryManager } from "../services/retry-manager.js";

const MESSAGE = "Send the report by Friday";
const noDelay = new RetryManager([0, 0]);
const ENV_KEYS = ["LLM_API_KEY", "TASK_CLASSIFIER_MODE", "TASK_CLASSIFIER_LLM_TIMEOUT_MS"] as const;
let previousEnv: Record<string, string | undefined> = {};

beforeEach(() => {
    previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    process.env.LLM_API_KEY = "test-key";
    process.env.TASK_CLASSIFIER_MODE = "llm";
    delete process.env.TASK_CLASSIFIER_LLM_TIMEOUT_MS;
});

afterEach(() => {
    configureMessageClassifier({ llmClassify: null });
    for (const key of ENV_KEYS) {
        if (previousEnv[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = previousEnv[key];
        }
    }
});

function classifierResponse(): LLMResponse {
    return {
        output_text: JSON.stringify({
            semanticType: "task",
            confidence: 0.9,
            reasoning: "A clear request.",
        }),
        provider: "openai",
    } as LLMResponse;
}

function retryableError(status: number): LLMError {
    return new LLMError({ message: `HTTP ${status}`, status, retryable: true });
}

/** Rejects with each scripted error in order, then returns a valid classification. */
function scriptedProvider(errors: Error[]) {
    const timeouts: Array<number | undefined> = [];
    let calls = 0;
    return {
        timeouts,
        get calls() {
            return calls;
        },
        generate: async (_request: unknown, options?: { timeoutMs?: number }) => {
            timeouts.push(options?.timeoutMs);
            const error = errors[calls];
            calls += 1;
            if (error) {
                throw error;
            }
            return classifierResponse();
        },
    };
}

test("timeout: a real provider abort is retried twice, then thrown", async () => {
    process.env.TASK_CLASSIFIER_LLM_TIMEOUT_MS = "20";
    let calls = 0;
    const hangingClient = {
        chat: {
            completions: {
                create: (_body: unknown, options: { signal: AbortSignal }) => {
                    calls += 1;
                    return new Promise((_resolve, reject) => {
                        options.signal.addEventListener("abort", () => {
                            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
                        });
                    });
                },
            },
        },
    };
    const provider = new OpenAIProvider(
        { provider: "openai", apiKey: "test-key", supportsResponsesApi: false, logRequests: false },
        hangingClient as never
    );

    await assert.rejects(
        classifyMessageWithLlm(MESSAGE, { provider, retryManager: noDelay }),
        (error: LLMError) => error.code === "LLM_TIMEOUT" && error.retryable
    );
    assert.equal(calls, 3);
});

test("error: a retryable provider error is retried twice, then thrown", async () => {
    const error = retryableError(500);
    const provider = scriptedProvider([error, error, error]);

    await assert.rejects(classifyMessageWithLlm(MESSAGE, { provider, retryManager: noDelay }), error);
    assert.equal(provider.calls, 3);
});

test("error: a non-retryable provider error is thrown without retrying", async () => {
    const error = new LLMError({ message: "HTTP 401", status: 401, retryable: false });
    const provider = scriptedProvider([error]);

    await assert.rejects(classifyMessageWithLlm(MESSAGE, { provider, retryManager: noDelay }), error);
    assert.equal(provider.calls, 1);
});

test("success on retry: returns the LLM result after transient failures", async () => {
    const provider = scriptedProvider([retryableError(503), retryableError(429)]);

    const result = await classifyMessageWithLlm(MESSAGE, { provider, retryManager: noDelay });

    assert.equal(provider.calls, 3);
    assert.equal(result?.semanticType, "task");
    assert.equal(result?.confidence, 0.9);
});

test("default retries back off 1s then 2s and use the 15s timeout", async () => {
    const provider = scriptedProvider([retryableError(500), retryableError(500)]);
    const startedAt = Date.now();

    await classifyMessageWithLlm(MESSAGE, { provider });

    assert.ok(Date.now() - startedAt >= 2900);
    assert.deepEqual(provider.timeouts, [15_000, 15_000, 15_000]);
});

test("missing API key returns null without calling the provider", async () => {
    process.env.LLM_API_KEY = "";
    const provider = scriptedProvider([]);

    assert.equal(await classifyMessageWithLlm(MESSAGE, { provider, retryManager: noDelay }), null);
    assert.equal(provider.calls, 0);
});

test("classifyMessage rejects instead of using regex after retries are exhausted", async () => {
    const error = retryableError(500);
    const provider = scriptedProvider([error, error, error]);
    configureMessageClassifier({
        llmClassify: (content) => classifyMessageWithLlm(content, { provider, retryManager: noDelay }),
    });

    await assert.rejects(classifyMessage(MESSAGE), ClassifierUnavailableError);
    assert.equal(provider.calls, 3);
});

test("classifyMessage returns the LLM result when a retry succeeds", async () => {
    const provider = scriptedProvider([retryableError(500)]);
    configureMessageClassifier({
        llmClassify: (content) => classifyMessageWithLlm(content, { provider, retryManager: noDelay }),
    });

    const result = await classifyMessage(MESSAGE);

    assert.equal(result.source, "llm");
    assert.equal(result.confidence, 0.9);
});
