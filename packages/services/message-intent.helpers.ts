import type { MessageSemanticType, TaskPriority } from "@semantask/types";

export type MessageIntentType =
    | "request"
    | "commit"
    | "reminder"
    | "decision"
    | "question"
    | "info";

export type ParticipantHint = {
    userId: string;
    username?: string | null;
    email?: string | null;
};

export type ExtractEntitiesOptions = {
    participants?: ParticipantHint[];
    /** Anchor for relative due-date parsing (defaults to Date.now()). */
    now?: Date;
};

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

const WEEKDAYS: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
};

function normalizeContent(content: string): string {
    return content.trim().replace(/\s+/g, " ");
}

function startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}

/**
 * Deterministic due-date heuristics (no NLP).
 * Supports: today/tonight, tomorrow, weekday, in N days, YYYY-MM-DD, MM/DD.
 */
export function parseDueAtCandidate(content: string, now = new Date()): Date | null {
    const normalized = normalizeContent(content);
    const lower = normalized.toLowerCase();
    const today = startOfUtcDay(now);

    if (/\b(today|tonight)\b/i.test(lower)) {
        return today;
    }

    if (/\btomorrow\b/i.test(lower)) {
        return addUtcDays(today, 1);
    }

    const inDays = lower.match(/\bin\s+(\d{1,3})\s+days?\b/);
    if (inDays) {
        return addUtcDays(today, Number(inDays[1]));
    }

    if (/\bnext week\b/i.test(lower)) {
        return addUtcDays(today, 7);
    }

    for (const [name, weekday] of Object.entries(WEEKDAYS)) {
        const pattern = new RegExp(`\\b(?:on\\s+)?${name}\\b`, "i");
        if (pattern.test(lower)) {
            const current = today.getUTCDay();
            let delta = (weekday - current + 7) % 7;
            if (delta === 0) {
                delta = 7;
            }
            return addUtcDays(today, delta);
        }
    }

    const iso = normalized.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (iso) {
        const year = Number(iso[1]);
        const month = Number(iso[2]);
        const day = Number(iso[3]);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return new Date(Date.UTC(year, month - 1, day));
        }
    }

    const us = normalized.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/);
    if (us) {
        const month = Number(us[1]);
        const day = Number(us[2]);
        const year = us[3] ? Number(us[3]) : now.getUTCFullYear();
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return new Date(Date.UTC(year, month - 1, day));
        }
    }

    return null;
}

/**
 * Match @mentions / emails / usernames against conversation participants.
 * Without participants, returns [] (never fabricates IDs).
 */
export function extractAssigneeUserIds(
    content: string,
    participants: ParticipantHint[] = []
): string[] {
    if (!participants.length) {
        return [];
    }

    const normalized = normalizeContent(content);
    const lower = normalized.toLowerCase();
    const matched = new Set<string>();

    for (const participant of participants) {
        if (!participant.userId) continue;
        const username = participant.username?.trim().toLowerCase();
        const email = participant.email?.trim().toLowerCase();

        if (username) {
            const mention = new RegExp(`(?:^|\\s)@${escapeRegExp(username)}\\b`, "i");
            const bare = new RegExp(`\\b${escapeRegExp(username)}\\b`, "i");
            if (mention.test(normalized) || bare.test(lower)) {
                matched.add(participant.userId);
                continue;
            }
        }

        if (email && lower.includes(email)) {
            matched.add(participant.userId);
        }
    }

    return [...matched];
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export function extractEntitiesFromContent(
    content: string,
    options: ExtractEntitiesOptions = {}
): ExtractedMessageEntities {
    const normalized = normalizeContent(content);
    const lower = normalized.toLowerCase();
    const now = options.now ?? new Date();

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
        assigneeUserIds: extractAssigneeUserIds(normalized, options.participants ?? []),
        dueAtCandidate: parseDueAtCandidate(normalized, now),
        priorityCandidate,
    };
}
