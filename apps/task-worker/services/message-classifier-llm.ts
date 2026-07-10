import { z } from "zod";
import { CLASSIFIABLE_SEMANTIC_TYPES } from "@semantask/types";
import type { MessageClassification } from "@semantask/services/message-classifier.service";
import { createDefaultLLMProvider } from "./llm/provider-factory.js";
import { parseJsonText } from "./llm/response-parser.js";
import { LLMError } from "./llm/types.js";

const classifierResponseSchema = z.object({
    semanticType: z.enum(CLASSIFIABLE_SEMANTIC_TYPES),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().min(1).max(2000),
});

function getClassifierModel(): string {
    return process.env.TASK_CLASSIFIER_MODEL
        || process.env.TASK_AGENT_MODEL
        || process.env.LLM_MODEL
        || "gpt-4o-mini";
}

function getClassifierTimeoutMs(): number {
    const configured = Number(process.env.TASK_CLASSIFIER_LLM_TIMEOUT_MS || 3000);
    return Number.isFinite(configured) && configured > 0 ? configured : 3000;
}

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

export async function classifyMessageWithLlm(content: string): Promise<MessageClassification | null> {
    const apiKey = process.env.OPENAI_API_KEY
        || process.env.LLM_API_KEY
        || process.env.HUGGINGFACE_API_KEY
        || process.env.AMD_API_KEY;

    if (!apiKey?.trim()) {
        return null;
    }

    const provider = createDefaultLLMProvider();
    const model = getClassifierModel();
    const timeoutMs = getClassifierTimeoutMs();
    const startedAt = Date.now();

    const response = await provider.generate({
        model,
        input: buildClassifierPrompt(content),
        temperature: 0,
    }, {
        timeoutMs,
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
