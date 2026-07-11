import type { MessageSemanticType, TaskPriority } from "@semantask/types";

export type MessageIntentType =
    | "request"
    | "commit"
    | "reminder"
    | "decision"
    | "question"
    | "info";

export type ExtractedMessageEntities = {
    actionVerb: string;
    objectText: string;
    assigneeUserIds: string[];
    dueAtCandidate: Date | null;
    priorityCandidate: TaskPriority | "";
};

const ACTION_VERBS = [
    "send",
    "schedule",
    "create",
    "make",
    "build",
    "fix",
    "update",
    "delete",
    "add",
    "remove",
    "implement",
    "design",
    "plan",
    "book",
    "remind",
    "set",
    "approve",
    "escalate",
    "automate",
    "trigger",
    "page",
] as const;

function normalizeContent(content: string): string {
    return content.trim().replace(/\s+/g, " ");
}

/**
 * Map product semantic taxonomy (2.2) onto speech-act intentType (MessageIntent schema).
 */
export function mapSemanticTypeToIntentType(
    semanticType: MessageSemanticType,
    content = ""
): MessageIntentType {
    switch (semanticType) {
        case "task":
        case "incident":
        case "automation":
        case "escalation":
            return "request";
        case "scheduling":
            return "reminder";
        case "approval":
            return "decision";
        case "chat": {
            const normalized = normalizeContent(content);
            if (normalized.endsWith("?")) {
                return "question";
            }
            return "info";
        }
        case "unknown":
        default:
            return "info";
    }
}

export function extractEntitiesFromContent(content: string): ExtractedMessageEntities {
    const normalized = normalizeContent(content);
    const lower = normalized.toLowerCase();

    let actionVerb = "";
    for (const verb of ACTION_VERBS) {
        const pattern = new RegExp(`\\b${verb}\\b`, "i");
        if (pattern.test(lower)) {
            actionVerb = verb;
            break;
        }
    }

    let priorityCandidate: TaskPriority | "" = "";
    if (/\b(urgent|asap|sev[0-1]|critical)\b/i.test(lower)) {
        priorityCandidate = "urgent";
    } else if (/\b(high priority|high-prio)\b/i.test(lower)) {
        priorityCandidate = "high";
    }

    return {
        actionVerb,
        objectText: normalized.slice(0, 512),
        assigneeUserIds: [],
        dueAtCandidate: null,
        priorityCandidate,
    };
}
