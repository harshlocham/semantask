import type { MessageSemanticType } from "@semantask/types";

export const GLOBAL_EXECUTION_CONFIDENCE_BASELINE = 0.7;

export const DEFAULT_EXECUTION_CONFIDENCE_THRESHOLDS: Record<MessageSemanticType, number> = {
    task: 0.7,
    scheduling: 0.7,
    incident: 0.75,
    automation: 0.75,
    escalation: 0.85,
    approval: 0.9,
    chat: 0.7,
    unknown: 0.7,
};

function clampThreshold(value: number): number {
    if (!Number.isFinite(value)) {
        return GLOBAL_EXECUTION_CONFIDENCE_BASELINE;
    }

    return Math.max(0, Math.min(1, value));
}

function parseThresholdOverrides(): Partial<Record<MessageSemanticType, number>> {
    const raw = process.env.TASK_EXECUTION_CONFIDENCE_THRESHOLDS;
    if (!raw?.trim()) {
        return {};
    }

    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
        }

        const overrides: Partial<Record<MessageSemanticType, number>> = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (!(key in DEFAULT_EXECUTION_CONFIDENCE_THRESHOLDS)) {
                continue;
            }

            if (typeof value !== "number") {
                continue;
            }

            overrides[key as MessageSemanticType] = clampThreshold(value);
        }

        return overrides;
    } catch {
        return {};
    }
}

export function getExecutionConfidenceThreshold(
    semanticType?: MessageSemanticType | string | null
): number {
    const overrides = parseThresholdOverrides();

    if (!semanticType || !(semanticType in DEFAULT_EXECUTION_CONFIDENCE_THRESHOLDS)) {
        return overrides.unknown
            ?? DEFAULT_EXECUTION_CONFIDENCE_THRESHOLDS.unknown
            ?? GLOBAL_EXECUTION_CONFIDENCE_BASELINE;
    }

    const typed = semanticType as MessageSemanticType;
    return overrides[typed] ?? DEFAULT_EXECUTION_CONFIDENCE_THRESHOLDS[typed];
}
