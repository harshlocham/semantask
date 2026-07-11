import type { MessageSemanticType } from "@semantask/types";

const ACTIONABLE_SEMANTIC_TYPES = new Set<MessageSemanticType>([
    "task",
    "scheduling",
    "incident",
    "automation",
]);

function isActionableSemanticType(type: MessageSemanticType): boolean {
    return ACTIONABLE_SEMANTIC_TYPES.has(type);
}

export type MessageClassification = {
    semanticType: MessageSemanticType;
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

function buildClassification(
    semanticType: MessageSemanticType,
    confidence: number,
    reasoning: string,
    source: MessageClassification["source"] = "regex"
): MessageClassification {
    return {
        semanticType,
        confidence,
        reasoning,
        source,
    };
}

/** Regex/heuristic ingress classifier. */
export function classifyMessageWithRegex(content: string): MessageClassification {
    const normalized = normalizeMessageContent(content).toLowerCase();

    if (!normalized) {
        return buildClassification("unknown", 0.95, "Message is empty");
    }

    if (normalized.length < 5) {
        return buildClassification("chat", 0.95, "Message too short to be actionable");
    }

    const schedulingPatterns = [
        /\b(schedule|calendar|meeting|book|appointment|remind|reminder)\b/i,
        /\b(tomorrow at|next week|on monday|on tuesday|on wednesday|on thursday|on friday)\b/i,
    ];
    const incidentPatterns = [
        /\b(incident|outage|down|broken|sev[0-9]|on[- ]call|pagerduty)\b/i,
        /\b(production (is )?down|site is down|service (is )?down)\b/i,
        /\b(critical bug|login bug|error spike|500 error)\b/i,
    ];
    const automationPatterns = [
        /\b(automate|automation|workflow|cron|pipeline|script)\b/i,
        /\b(run (the )?job|trigger (the )?workflow)\b/i,
    ];
    const approvalPatterns = [
        /\b(approve|approval|sign[- ]off|review and approve)\b/i,
        /\b(needs? (your )?approval|pending approval)\b/i,
    ];
    const escalationPatterns = [
        /\b(escalate|escalation|urgent help|page (the )?team)\b/i,
        /\b(raise (to|with) (management|leadership))\b/i,
    ];
    const taskPatterns = [
        /^(create|make|build|fix|update|delete|add|remove|implement|design|plan|send|set)/i,
        /\b(need|should|must|have to|required to|please|can you|will you|would you|could you)\b/i,
        /\b(task|todo|issue|bug|feature|request|action|step|deadline|due|urgent|asap)\b/i,
        /[?!]$/,
    ];
    const chatPatterns = [
        /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|lol|haha|nice|great)/i,
        /^(how are|what's up|good morning|good night|see you|bye|goodbye)/i,
        /^\W*(lol|haha|omg|btw|fyi|idk|imo|smh)\W*$/i,
    ];

    const matches = (patterns: RegExp[]) => patterns.some((pattern) => pattern.test(normalized));
    const matchesScheduling = matches(schedulingPatterns);
    const matchesIncident = matches(incidentPatterns);
    const matchesAutomation = matches(automationPatterns);
    const matchesApproval = matches(approvalPatterns);
    const matchesEscalation = matches(escalationPatterns);
    const matchesTaskPattern = matches(taskPatterns);
    const matchesChatPattern = matches(chatPatterns);

    if (matchesScheduling && !matchesIncident) {
        return buildClassification("scheduling", 0.82, "Message matches scheduling patterns");
    }

    if (matchesIncident) {
        return buildClassification("incident", 0.84, "Message matches incident patterns");
    }

    if (matchesAutomation) {
        return buildClassification("automation", 0.8, "Message matches automation patterns");
    }

    if (matchesApproval) {
        return buildClassification("approval", 0.8, "Message matches approval patterns");
    }

    if (matchesEscalation) {
        return buildClassification("escalation", 0.8, "Message matches escalation patterns");
    }

    if (matchesChatPattern && !matchesTaskPattern) {
        return buildClassification("chat", 0.85, "Message matches casual chat patterns");
    }

    if (matchesTaskPattern) {
        return buildClassification("task", 0.8, "Message matches task-like patterns");
    }

    return buildClassification("chat", 0.6, "Message is ambiguous; treating as chat by default");
}

function actionableDecision(classification: MessageClassification, threshold: number): boolean {
    return isActionableSemanticType(classification.semanticType)
        && classification.confidence >= threshold;
}

function logShadowDisagreement(content: string, regex: MessageClassification, llm: MessageClassification): void {
    const threshold = getClassifierThreshold();
    const regexActionable = actionableDecision(regex, threshold);
    const llmActionable = actionableDecision(llm, threshold);

    if (regex.semanticType === llm.semanticType && regexActionable === llmActionable) {
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

export function isActionableClassification(
    classification: MessageClassification,
    threshold = getClassifierThreshold()
): boolean {
    return actionableDecision(classification, threshold);
}

/** @deprecated Use isActionableClassification */
export function isTaskClassification(
    classification: MessageClassification,
    threshold = getClassifierThreshold()
): boolean {
    return isActionableClassification(classification, threshold);
}
