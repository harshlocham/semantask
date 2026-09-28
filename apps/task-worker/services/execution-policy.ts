import type { ExecutionMode, MessageSemanticType, TaskExecutionActionType } from "@semantask/types";
import {
    getEffectiveExecutionMode,
    isExecutionModeEnforce,
} from "@semantask/services/organization-policy.service";
import {
    getExecutionConfidenceThreshold,
    GLOBAL_EXECUTION_CONFIDENCE_BASELINE,
} from "./execution-confidence.js";
import {
    applyPromptGuardDecision,
    resolvePromptGuardMode,
    type PromptGuardMode,
    validateToolArgsAgainstContext,
} from "./prompt-guard.js";
import { getEnvAllowedEmailDomains } from "../config/tools.js";

/**
 * Org `OrganizationPolicy` overlays code defaults for
 * `confidenceThresholds`, `allowedEmailDomains`, and `promptGuardMode`.
 * Execution mode uses `getEffectiveExecutionMode` (org field wins).
 */
export type OrganizationPolicyOverlay = {
    version: number;
    confidenceThresholds?: Record<string, number> | null;
    allowedEmailDomains?: string[] | null;
    requireApprovalFor?: string[];
    toolDenyList?: string[];
    promptGuardMode?: PromptGuardMode | null;
    executionMode?: ExecutionMode | null;
    /** Per-tool autonomy. Missing keys inherit the org execution mode. */
    toolExecutionModes?: Record<string, string> | null;
};

type RequestedPayload = {
    actionType: TaskExecutionActionType;
    parameters?: Record<string, unknown>;
    confidence?: number;
    needsApproval?: boolean;
    semanticType?: MessageSemanticType;
    /** Pre-loaded conversation participant emails (lowercase). */
    participantEmails?: string[];
    /** Pre-loaded task-owner contact emails (lowercase). */
    contactEmails?: string[];
    taskId?: string;
    organizationId?: string | null;
    orgPolicy?: OrganizationPolicyOverlay | null;
    /** Override enforce for tests. Production always enforces. */
    executionModeEnforce?: boolean;
};

export type ExecutionPolicyOutcome = "auto_execute" | "approval_required" | "blocked";

export type ExecutionRiskLevel = "low" | "medium" | "high";

export type ExecutionPolicyDecision = {
    outcome: ExecutionPolicyOutcome;
    riskLevel: ExecutionRiskLevel;
    reasons: string[];
    semanticType?: MessageSemanticType;
    confidence: number;
    threshold: number;
    orgPolicyVersion?: number | null;
    executionMode?: ExecutionMode;
    executionModeEnforced?: boolean;
};

function toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    }

    if (typeof value === "string" && value.trim().length > 0) {
        return [value.trim()];
    }

    return [];
}

function emailDomain(email: string): string {
    const at = email.lastIndexOf("@");
    if (at < 0 || at === email.length - 1) return "";
    return email.slice(at + 1).toLowerCase();
}

function resolveAllowedEmailDomains(orgPolicy?: OrganizationPolicyOverlay | null): string[] {
    if (orgPolicy?.allowedEmailDomains && orgPolicy.allowedEmailDomains.length > 0) {
        return orgPolicy.allowedEmailDomains.map((d) => d.toLowerCase());
    }
    return getEnvAllowedEmailDomains();
}

function resolveConfidenceThreshold(
    semanticType: MessageSemanticType | undefined,
    orgPolicy?: OrganizationPolicyOverlay | null
): number {
    if (orgPolicy?.confidenceThresholds && semanticType) {
        const override = orgPolicy.confidenceThresholds[semanticType];
        if (typeof override === "number" && Number.isFinite(override)) {
            return Math.max(0, Math.min(1, override));
        }
    }
    if (orgPolicy?.confidenceThresholds?.unknown != null) {
        const override = orgPolicy.confidenceThresholds.unknown;
        if (typeof override === "number" && Number.isFinite(override)) {
            return Math.max(0, Math.min(1, override));
        }
    }
    return getExecutionConfidenceThreshold(semanticType);
}

const TOOL_AUTONOMY_MODES = new Set(["off", "suggest_only", "require_approval", "auto_execute"]);

function resolveToolAutonomyMode(
    orgPolicy: OrganizationPolicyOverlay | null,
    actionKey: string
): string | null {
    const raw = orgPolicy?.toolExecutionModes?.[actionKey];
    if (typeof raw !== "string") return null;
    const mode = raw.trim().toLowerCase();
    return TOOL_AUTONOMY_MODES.has(mode) ? mode : null;
}

function resolveSemanticType(payload: RequestedPayload): MessageSemanticType | undefined {
    if (payload.semanticType) {
        return payload.semanticType;
    }

    const fromParams = payload.parameters?.semanticType;
    if (typeof fromParams === "string") {
        return fromParams as MessageSemanticType;
    }

    return undefined;
}

/** Apply workspace executionMode gate (ADR-005). Pure — used for enforce and shadow would-gate. */
export function applyExecutionModeGate(
    decision: ExecutionPolicyDecision,
    mode: ExecutionMode,
    enforce: boolean
): ExecutionPolicyDecision {
    const withMode: ExecutionPolicyDecision = {
        ...decision,
        executionMode: mode,
        executionModeEnforced: enforce,
    };

    if (!enforce) {
        return withMode;
    }

    if (mode === "suggest_only") {
        return {
            ...withMode,
            outcome: "blocked",
            riskLevel: "high",
            reasons: ["execution_mode:suggest_only"],
        };
    }

    if (mode === "require_approval" && decision.outcome === "auto_execute") {
        return {
            ...withMode,
            outcome: "approval_required",
            riskLevel: decision.riskLevel === "low" ? "medium" : decision.riskLevel,
            reasons: [
                ...decision.reasons,
                "execution_mode:require_approval",
            ],
        };
    }

    return withMode;
}

export function evaluateExecutionPolicy(payload: RequestedPayload): ExecutionPolicyDecision {
    const confidence = typeof payload.confidence === "number" ? payload.confidence : 0.5;
    const semanticType = resolveSemanticType(payload);
    const orgPolicy = payload.orgPolicy ?? null;
    const threshold = resolveConfidenceThreshold(semanticType, orgPolicy);
    const intentLabel = semanticType ?? "unknown";
    const reasons: string[] = [];
    const orgPolicyVersion = orgPolicy ? orgPolicy.version : null;
    const executionMode = getEffectiveExecutionMode({
        organizationId: payload.organizationId,
        executionMode: orgPolicy?.executionMode ?? null,
    });
    const enforce = payload.executionModeEnforce ?? isExecutionModeEnforce();

    const actionKey = String(payload.actionType).toLowerCase();

    if (enforce && executionMode === "suggest_only") {
        return {
            outcome: "blocked",
            riskLevel: "high",
            reasons: ["execution_mode:suggest_only"],
            semanticType,
            confidence,
            threshold,
            orgPolicyVersion,
            executionMode,
            executionModeEnforced: true,
        };
    }

    const toolMode = resolveToolAutonomyMode(orgPolicy, actionKey);
    if (toolMode === "off" || toolMode === "suggest_only") {
        return applyExecutionModeGate({
            outcome: "blocked",
            riskLevel: "high",
            reasons: [`tool_execution_mode:${toolMode}`],
            semanticType,
            confidence,
            threshold,
            orgPolicyVersion,
        }, executionMode, enforce);
    }

    if (toolMode === "require_approval") {
        reasons.push("tool_execution_mode:require_approval");
    }

    if (orgPolicy?.toolDenyList?.includes(actionKey)) {
        return applyExecutionModeGate({
            outcome: "blocked",
            riskLevel: "high",
            reasons: [
                `Tool "${payload.actionType}" is denied by organization policy v${orgPolicy.version}.`,
            ],
            semanticType,
            confidence,
            threshold,
            orgPolicyVersion,
        }, executionMode, enforce);
    }

    if (payload.needsApproval) {
        reasons.push("Upstream classifier marked action as requiring approval.");
    }

    if (orgPolicy?.requireApprovalFor?.includes(actionKey)) {
        reasons.push(
            `Organization policy v${orgPolicy.version} requires approval for "${payload.actionType}".`
        );
    }

    if (confidence < threshold) {
        const source = orgPolicy?.confidenceThresholds?.[intentLabel] != null
            || (orgPolicy?.confidenceThresholds && !semanticType)
            ? `org policy v${orgPolicy?.version}`
            : "default";
        reasons.push(
            `Low confidence for intent "${intentLabel}" (${confidence.toFixed(2)} < ${threshold.toFixed(2)}; ${source}).`
        );
    }

    const parameters = payload.parameters ?? {};

    if (payload.actionType === "send_email") {
        const recipients = toStringArray(parameters.to);
        if (recipients.length === 0) {
            return applyExecutionModeGate({
                outcome: "blocked",
                riskLevel: "high",
                reasons: ["Email action has no valid recipients."],
                semanticType,
                confidence,
                threshold,
                orgPolicyVersion,
            }, executionMode, enforce);
        }

        const allowedDomains = resolveAllowedEmailDomains(orgPolicy);
        if (allowedDomains.length > 0) {
            const externalRecipients = recipients.filter((recipient) => {
                if (!recipient.includes("@")) {
                    return false;
                }
                return !allowedDomains.includes(emailDomain(recipient));
            });
            if (externalRecipients.length > 0) {
                reasons.push(
                    orgPolicy?.allowedEmailDomains?.length
                        ? `One or more recipients are outside allowed domains (org policy v${orgPolicy.version}).`
                        : "One or more recipients are outside allowed domains."
                );
            }
        }

        if (recipients.length > 5) {
            reasons.push("Email action has more than 5 recipients.");
        }
    }

    if (payload.actionType === "schedule_meeting") {
        const participants = toStringArray(parameters.participants).concat(toStringArray(parameters.attendees));
        if (participants.length === 0) {
            reasons.push("Meeting action has no explicit participants in parameters.");
        }
    }

    if (payload.actionType === "create_github_issue") {
        const title = typeof parameters.title === "string" ? parameters.title.trim() : "";
        if (title.length === 0) {
            reasons.push("GitHub issue action is missing a title.");
        }
    }

    const promptGuardMode = resolvePromptGuardMode(orgPolicy?.promptGuardMode);
    if (
        promptGuardMode !== "off"
        && (payload.actionType === "send_email" || payload.actionType === "schedule_meeting")
    ) {
        const guardValidation = validateToolArgsAgainstContext({
            tool: payload.actionType,
            params: parameters,
            participantEmails: payload.participantEmails ?? [],
            contactEmails: payload.contactEmails ?? [],
        });
        const guardDecision = applyPromptGuardDecision(guardValidation, {
            taskId: payload.taskId,
            tool: payload.actionType,
            mode: promptGuardMode,
        });

        if (!guardValidation.ok && promptGuardMode === "enforce" && !guardDecision.allow) {
            return applyExecutionModeGate({
                outcome: "blocked",
                riskLevel: "high",
                reasons: guardValidation.reasons,
                semanticType,
                confidence,
                threshold,
                orgPolicyVersion,
            }, executionMode, enforce);
        }

        if (!guardValidation.ok && promptGuardMode === "monitor") {
            reasons.push(...guardValidation.reasons.map((reason) => `[prompt_guard:monitor] ${reason}`));
        }
    }

    if (reasons.length === 0) {
        const passReason = payload.actionType === "none"
            ? `Policy passed for intent "${intentLabel}" (confidence ${confidence.toFixed(2)} ≥ ${threshold.toFixed(2)}); agent-runner will decide the next tool.`
            : `Policy passed for intent "${intentLabel}" (confidence ${confidence.toFixed(2)} ≥ ${threshold.toFixed(2)}).`;

        return applyExecutionModeGate({
            outcome: "auto_execute",
            riskLevel: "low",
            reasons: [passReason],
            semanticType,
            confidence,
            threshold,
            orgPolicyVersion,
        }, executionMode, enforce);
    }

    const highRiskReason = reasons.some((reason) =>
        reason.includes("outside allowed domains")
        || reason.includes("no valid recipients")
        || reason.includes("No executable action")
    );

    return applyExecutionModeGate({
        outcome: "approval_required",
        riskLevel: highRiskReason ? "high" : "medium",
        reasons,
        semanticType,
        confidence,
        threshold,
        orgPolicyVersion,
    }, executionMode, enforce);
}

export { GLOBAL_EXECUTION_CONFIDENCE_BASELINE };

export default evaluateExecutionPolicy;
