export type MessageClassification = {
    isTask: boolean;
    confidence: number;
    reasoning: string;
    source: "regex" | "llm" | "llm_fallback";
};

export type ClassifierMode = "regex" | "shadow" | "llm";

export type LlmClassifyFn = (content: string) => Promise<MessageClassification | null>;

export type ClassifierDisagreementPayload = {
    regex: MessageClassification;
    llm: MessageClassification;
    contentPreview: string;
};

export type ClassifierDisagreementLogger = (payload: ClassifierDisagreementPayload) => void;

let configuredLlmClassify: LlmClassifyFn | null = null;
let disagreementLogger: ClassifierDisagreementLogger | null = null;

export function configureMessageClassifier(options: {
    llmClassify?: LlmClassifyFn | null;
    onDisagreement?: ClassifierDisagreementLogger | null;
}): void {
    if (options.llmClassify !== undefined) {
        configuredLlmClassify = options.llmClassify;
    }

    if (options.onDisagreement !== undefined) {
        disagreementLogger = options.onDisagreement;
    }
}

export function getClassifierMode(): ClassifierMode {
    const raw = (process.env.TASK_CLASSIFIER_MODE || "regex").trim().toLowerCase();
    if (raw === "shadow" || raw === "llm") {
        return raw;
    }

    return "regex";
}

export function getClassifierThreshold(): number {
    const configured = Number(process.env.TASK_CLASSIFIER_THRESHOLD || 0.7);
    if (!Number.isFinite(configured)) {
        return 0.7;
    }

    return Math.max(0, Math.min(1, configured));
}

export function normalizeMessageContent(content: string): string {
    return content.trim().replace(/\s+/g, " ");
}

/** Regex/heuristic ingress classifier (pre-2.1 default). */
export function classifyMessageWithRegex(content: string): MessageClassification {
    const normalized = normalizeMessageContent(content).toLowerCase();

    if (normalized.length < 5) {
        return {
            isTask: false,
            confidence: 0.95,
            reasoning: "Message too short to be a task request",
            source: "regex",
        };
    }

    const taskPatterns = [
        /^(create|make|build|fix|update|delete|add|remove|implement|design|plan|schedule|send|book|remind|set)/i,
        /\b(need|should|must|have to|required to|please|can you|will you|would you|could you)\b/i,
        /\b(task|todo|issue|bug|feature|request|action|step|deadline|due|urgent|asap)\b/i,
        /[?!]$/,
    ];

    const chatPatterns = [
        /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|lol|haha|nice|great)/i,
        /^(how are|what's up|good morning|good night|see you|bye|goodbye)/i,
        /^\W*(lol|haha|omg|btw|fyi|idk|imo|smh)\W*$/i,
    ];

    const matchesTaskPattern = taskPatterns.some((pattern) => pattern.test(normalized));
    const matchesChatPattern = chatPatterns.some((pattern) => pattern.test(normalized));

    if (matchesChatPattern && !matchesTaskPattern) {
        return {
            isTask: false,
            confidence: 0.85,
            reasoning: "Message matches casual chat patterns",
            source: "regex",
        };
    }

    if (matchesTaskPattern) {
        return {
            isTask: true,
            confidence: 0.8,
            reasoning: "Message matches task-like patterns",
            source: "regex",
        };
    }

    return {
        isTask: false,
        confidence: 0.6,
        reasoning: "Message is ambiguous; treating as chat by default",
        source: "regex",
    };
}

function taskDecision(classification: MessageClassification, threshold: number): boolean {
    return classification.isTask && classification.confidence >= threshold;
}

function logShadowDisagreement(content: string, regex: MessageClassification, llm: MessageClassification): void {
    const threshold = getClassifierThreshold();
    const regexSaysTask = taskDecision(regex, threshold);
    const llmSaysTask = taskDecision(llm, threshold);

    if (regexSaysTask === llmSaysTask) {
        return;
    }

    disagreementLogger?.({
        regex,
        llm,
        contentPreview: normalizeMessageContent(content).slice(0, 200),
    });
}

async function classifyWithLlmOrFallback(content: string): Promise<MessageClassification> {
    const regexFallback = classifyMessageWithRegex(content);

    if (!configuredLlmClassify) {
        return regexFallback;
    }

    try {
        const llmResult = await configuredLlmClassify(content);
        if (!llmResult) {
            return {
                ...regexFallback,
                source: "llm_fallback",
                reasoning: `LLM classifier unavailable; ${regexFallback.reasoning}`,
            };
        }

        return {
            ...llmResult,
            source: "llm",
        };
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
            ...regexFallback,
            source: "llm_fallback",
            reasoning: `LLM classifier failed (${detail}); ${regexFallback.reasoning}`,
        };
    }
}

/**
 * Classify message intent for task creation.
 * - `regex`: heuristic only
 * - `shadow`: run LLM + regex, log disagreements, authority stays on regex
 * - `llm`: LLM with regex fallback on failure
 */
export async function classifyMessage(content: string): Promise<MessageClassification> {
    const mode = getClassifierMode();
    const regex = classifyMessageWithRegex(content);

    if (mode === "regex") {
        return regex;
    }

    if (mode === "llm") {
        return classifyWithLlmOrFallback(content);
    }

    const llm = await classifyWithLlmOrFallback(content);
    logShadowDisagreement(content, regex, llm);
    return regex;
}

export function isTaskClassification(classification: MessageClassification, threshold = getClassifierThreshold()): boolean {
    return taskDecision(classification, threshold);
}
