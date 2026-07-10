import type { MessageSemanticType } from "@semantask/types";
import { normalizeSemanticTypeForClient } from "@semantask/types";

const INTENT_BADGE_STYLES: Record<
    Exclude<MessageSemanticType, "chat">,
    { label: string; className: string }
> = {
    task: {
        label: "Task",
        className: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
    },
    incident: {
        label: "Incident",
        className: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
    },
    scheduling: {
        label: "Scheduling",
        className: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30",
    },
    escalation: {
        label: "Escalation",
        className: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
    },
    approval: {
        label: "Approval",
        className: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    },
    automation: {
        label: "Automation",
        className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    },
    unknown: {
        label: "Unknown",
        className: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]",
    },
};

interface IntentBadgeProps {
    semanticType?: string | null;
    confidence?: number;
}

export function IntentBadge({ semanticType, confidence }: IntentBadgeProps) {
    const normalized = normalizeSemanticTypeForClient(semanticType);

    if (normalized === "chat") {
        return null;
    }

    const config = INTENT_BADGE_STYLES[normalized];
    const confidenceLabel = typeof confidence === "number"
        ? `${Math.round(confidence * 100)}%`
        : null;

    return (
        <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${config.className}`}
            title={confidenceLabel ? `Confidence: ${confidenceLabel}` : config.label}
        >
            {config.label}
            {confidenceLabel ? <span className="normal-case opacity-70">{confidenceLabel}</span> : null}
        </span>
    );
}
