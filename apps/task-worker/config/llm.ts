import type { LLMProviderConfig } from "../services/llm/types.js";
import { firstNonEmpty, parseBool, parsePositiveNumber } from "./parse.js";

export type LlmProviderName = LLMProviderConfig["provider"];

function resolveProviderName(raw: string): LlmProviderName {
    if (raw === "openai-compatible") {
        return "openai-compatible";
    }
    if (raw === "huggingface") {
        return "huggingface";
    }
    if (raw === "amd-openai-compatible") {
        return "amd-openai-compatible";
    }
    return "openai";
}

export function getLlmApiKey(): string {
    return firstNonEmpty(process.env.LLM_API_KEY) ?? "";
}

export function getLlmBaseUrl(): string | undefined {
    return firstNonEmpty(process.env.LLM_BASE_URL);
}

/** Factory model: TASK_AGENT_MODEL (may be unset). */
export function getLlmModel(): string | undefined {
    return firstNonEmpty(process.env.TASK_AGENT_MODEL);
}

/** Step-loop model: TASK_AGENT_MODEL only, then gpt-4o-mini. */
export function getAgentModelOrDefault(): string {
    return firstNonEmpty(process.env.TASK_AGENT_MODEL) ?? "gpt-4o-mini";
}

export function getPlannerModel(): string {
    return firstNonEmpty(process.env.TASK_PLANNER_MODEL) ?? "gpt-4o-mini";
}

export function getReflectionModel(): string {
    return firstNonEmpty(process.env.TASK_REFLECTION_MODEL) ?? "gpt-4o-mini";
}

export function getClassifierModel(): string {
    return firstNonEmpty(
        process.env.TASK_CLASSIFIER_MODEL,
        process.env.TASK_AGENT_MODEL,
    ) ?? "gpt-4o-mini";
}

export function getClassifierTimeoutMs(): number {
    return parsePositiveNumber(process.env.TASK_CLASSIFIER_LLM_TIMEOUT_MS, 15_000);
}

export function getLlmTimeoutMs(): number {
    return parsePositiveNumber(
        process.env.TASK_AGENT_LLM_TIMEOUT_MS || process.env.LLM_REQUEST_TIMEOUT_MS,
        30_000,
    );
}

export function getLlmLogRequests(): boolean {
    return process.env.LLM_LOG_REQUESTS !== "false";
}

export function getLlmProviderConfig(): LLMProviderConfig {
    const rawProvider = (process.env.LLM_PROVIDER || "openai").toLowerCase();
    const providerName = resolveProviderName(rawProvider);
    const baseUrl = getLlmBaseUrl();
    const supportsResponsesApi = parseBool(
        process.env.LLM_SUPPORTS_RESPONSES_API,
        providerName !== "amd-openai-compatible" && providerName !== "huggingface",
    );
    const transport = providerName === "huggingface"
        ? (parseBool(
            process.env.HUGGINGFACE_OPENAI_COMPATIBLE,
            Boolean(baseUrl?.endsWith("/v1")),
        ) ? "openai-compatible" : "inference-api")
        : "openai-compatible";

    return {
        provider: providerName,
        apiKey: getLlmApiKey(),
        baseUrl,
        timeoutMs: getLlmTimeoutMs(),
        logRequests: getLlmLogRequests(),
        model: getLlmModel(),
        providerProfile: process.env.LLM_PROVIDER_PROFILE || providerName,
        providerDisplayName: providerName,
        transport,
        supportsResponsesApi,
        supportsStructuredOutputs: process.env.LLM_SUPPORTS_STRUCTURED_OUTPUTS !== "false",
        supportsToolCalling: parseBool(
            process.env.LLM_SUPPORTS_TOOL_CALLING,
            providerName !== "huggingface",
        ),
        supportsStreaming: parseBool(process.env.LLM_SUPPORTS_STREAMING, true),
        supportsJsonMode: parseBool(
            process.env.LLM_SUPPORTS_JSON_MODE,
            providerName !== "huggingface",
        ),
    };
}
