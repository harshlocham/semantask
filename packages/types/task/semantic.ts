export const MESSAGE_SEMANTIC_TYPES = [
    "chat",
    "task",
    "incident",
    "scheduling",
    "escalation",
    "approval",
    "automation",
    "unknown",
] as const;

export type MessageSemanticType = (typeof MESSAGE_SEMANTIC_TYPES)[number];

export const LEGACY_SEMANTIC_TYPES = ["decision", "reminder"] as const;

export type LegacyMessageSemanticType = (typeof LEGACY_SEMANTIC_TYPES)[number];

export const ACTIONABLE_SEMANTIC_TYPES = [
    "task",
    "scheduling",
    "incident",
    "automation",
] as const;

export type ActionableSemanticType = (typeof ACTIONABLE_SEMANTIC_TYPES)[number];

export const CLASSIFIABLE_SEMANTIC_TYPES = [
    "chat",
    "task",
    "incident",
    "scheduling",
    "escalation",
    "approval",
    "automation",
] as const;

export type ClassifiableSemanticType = (typeof CLASSIFIABLE_SEMANTIC_TYPES)[number];

const KNOWN_SEMANTIC_TYPES = new Set<string>(MESSAGE_SEMANTIC_TYPES);

export function isKnownMessageSemanticType(value: string): value is MessageSemanticType {
    return KNOWN_SEMANTIC_TYPES.has(value);
}

export function mapLegacySemanticType(value: string): MessageSemanticType {
    if (value === "decision") {
        return "approval";
    }

    if (value === "reminder") {
        return "scheduling";
    }

    if (isKnownMessageSemanticType(value)) {
        return value;
    }

    return "unknown";
}

export function isActionableSemanticType(
    type: MessageSemanticType | LegacyMessageSemanticType | string | undefined | null
): type is ActionableSemanticType {
    if (!type) {
        return false;
    }

    const normalized = mapLegacySemanticType(type);
    return (ACTIONABLE_SEMANTIC_TYPES as readonly string[]).includes(normalized);
}

/** Maps legacy and unrecognized server values to a safe client-facing intent. */
export function normalizeSemanticTypeForClient(
    raw?: string | null
): MessageSemanticType {
    if (!raw) {
        return "unknown";
    }

    if (raw === "decision") {
        return "approval";
    }

    if (raw === "reminder") {
        return "scheduling";
    }

    if (isKnownMessageSemanticType(raw)) {
        return raw;
    }

    return "chat";
}
