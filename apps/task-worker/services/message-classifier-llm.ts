import { z } from "zod";
import { CLASSIFIABLE_SEMANTIC_TYPES } from "@semantask/types";
import type { MessageClassification } from "@semantask/services/message-classifier.service";
import { createDefaultLLMProvider } from "./llm/provider-factory.js";
import { parseJsonText } from "./llm/response-parser.js";
import type { BaseLLMProvider } from "./llm/base-provider.js";
import { LLMError } from "./llm/types.js";
import { RetryManager } from "./retry-manager.js";
import { logExecution } from "./execution-logger.js";
import { getClassifierModel, getClassifierTimeoutMs, getLlmApiKey } from "../config/llm.js";

const CLASSIFIER_MAX_RETRIES = 2;
const classifierRetryManager = new RetryManager([1000, 2000]);

export type ClassifyMessageWithLlmDeps = {
    provider?: Pick<BaseLLMProvider, "generate">;
    retryManager?: RetryManager;
};

const classifierResponseSchema = z.object({
    semanticType: z.enum(CLASSIFIABLE_SEMANTIC_TYPES),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().min(1).max(2000),
});

function buildClassifierPrompt(content: string): string {
    return JSON.stringify({
        systemPrompt: [
            "You classify chat messages for a collaboration app.",
            "Return one JSON object only with keys: semanticType, confidence, reasoning.",
            "semanticType must be one of: chat, task, incident, scheduling, escalation, approval, automation.",
            "chat: greetings, acknowledgements, small talk, non-actionable discussion.",
            "task: generic action requests, deliverables, follow-up work, emails, issues.",
            "incident: outages, production issues, bugs, errors, on-call events.",
            "scheduling: meetings, calendar events, reminders, appointments.",
            "escalation: urgent help, paging leadership, raising severity.",
            "approval: sign-off, review approval, permission requests.",
            "automation: workflows, scripts, cron jobs, pipeline triggers.",
            "confidence is 0 to 1. reasoning is one short sentence.",
        ].join(" "),
        userMessage: content,
    });
}

function extractResponseText(response: { output_text?: string; output?: unknown }): string {
    if (typeof response.output_text === "string" && response.output_text.trim().length > 0) {
        return response.output_text.trim();
    }

    if (Array.isArray(response.output)) {
        const chunks: string[] = [];
        for (const item of response.output) {
            if (!item || typeof item !== "object") continue;
            const record = item as Record<string, unknown>;
            const content = record.content;
            if (!Array.isArray(content)) continue;
            for (const part of content) {
                if (!part || typeof part !== "object") continue;
                const partRecord = part as Record<string, unknown>;
                if (typeof partRecord.text === "string") {
                    chunks.push(partRecord.text);
                }
            }
        }

        if (chunks.length > 0) {
            return chunks.join("\n").trim();
        }
    }

    return "";
}

async function requestClassification(
    provider: Pick<BaseLLMProvider, "generate">,
    content: string
): Promise<MessageClassification> {
    const model = getClassifierModel();
    const timeoutMs = getClassifierTimeoutMs();
    const startedAt = Date.now();

    const response = await provider.generate({
        model,
        input: buildClassifierPrompt(content),
        temperature: 0,
    }, {
        timeoutMs,
        // RetryManager owns classifier retries. SDK retries would multiply each attempt.
        maxRetries: 0,
    });

    const text = extractResponseText(response);
    if (!text) {
        throw new LLMError({
            message: "LLM classifier returned empty response",
            code: "LLM_CLASSIFIER_EMPTY",
            provider: response.provider,
            retryable: true,
        });
    }

    const parsed = parseJsonText<unknown>(text);
    const validated = classifierResponseSchema.safeParse(parsed.value);
    if (!validated.success) {
        throw new LLMError({
            message: "LLM classifier response parsing failed",
            code: "LLM_CLASSIFIER_PARSE",
            provider: response.provider,
            retryable: false,
            details: validated.error.flatten(),
        });
    }

    console.info("message-classifier llm:classified", {
        model,
        provider: response.provider,
        latencyMs: Date.now() - startedAt,
        semanticType: validated.data.semanticType,
        confidence: validated.data.confidence,
    });

    return {
        semanticType: validated.data.semanticType,
        confidence: validated.data.confidence,
        reasoning: validated.data.reasoning,
        source: "llm",
    };
}

/**
 * Returns null only when no API key is configured. A timeout or provider error
 * is retried, then thrown so the outbox event stays retryable.
 */
export async function classifyMessageWithLlm(
    content: string,
    deps: ClassifyMessageWithLlmDeps = {}
): Promise<MessageClassification | null> {
    if (!getLlmApiKey().trim()) {
        return null;
    }

    const provider = deps.provider ?? createDefaultLLMProvider();
    const retryManager = deps.retryManager ?? classifierRetryManager;

    return retryManager.execute({
        retryCount: 0,
        maxRetries: CLASSIFIER_MAX_RETRIES,
        operation: () => requestClassification(provider, content),
        shouldRetry: (error) => (error instanceof LLMError ? error.retryable : true),
        onRetry: ({ attempt, delayMs, reason }) => {
            logExecution("warn", {
                event: "classifier.llm.retry",
                attempt,
                delayMs,
                error: reason,
            });
        },
    });
}
