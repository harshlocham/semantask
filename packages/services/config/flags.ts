import type { ExecutionMode } from "@semantask/types";
import { isEnvFlagEnabled } from "./parse";

export type ClassifierMode = "regex" | "shadow" | "llm";

/** WorkSuggestion ingress is always on. Env `SUGGESTION_INGRESS` is not read. */
export function isSuggestionIngressEnabled(): boolean {
    return true;
}

/** True when execution enqueue must be refused for the given effective mode. */
export function shouldBlockExecutionEnqueue(executionMode: ExecutionMode): boolean {
    return executionMode === "suggest_only";
}

/** Accept never creates execution. Env `ACCEPT_CREATES_EXECUTION` is not read. */
export function isAcceptCreatesExecutionEnabled(): boolean {
    return false;
}

/** Kept at accept call sites. No-op: the dangerous env cannot be turned on. */
export function assertAcceptCreatesCoordinationOnly(): void {
    // coordination-only accept is the only path
}

/** Work Inbox `/inbox` is always on. Env `WORK_INBOX_UI` is not read. */
export function isWorkInboxUiEnabled(): boolean {
    return true;
}

/** COORDINATION_BOARD=0|1 (default 0). Expose `/inbox/board`. */
export function isCoordinationBoardEnabled(raw?: string | null): boolean {
    return isEnvFlagEnabled(raw ?? process.env.COORDINATION_BOARD, false);
}

/** ORG_DASHBOARD=0|1 (default 0). Expose `/inbox/dashboard` + work-summary API. */
export function isOrgDashboardEnabled(raw?: string | null): boolean {
    return isEnvFlagEnabled(raw ?? process.env.ORG_DASHBOARD, false);
}

/**
 * TASK_CLASSIFIER_MODE: llm (default) | regex | shadow.
 * Blank or unset is llm. An unrecognized value stays regex so a typo does not call the model.
 */
export function getClassifierMode(raw?: string | null): ClassifierMode {
    const source = raw == null ? process.env.TASK_CLASSIFIER_MODE : raw;
    const value = (source ?? "").trim().toLowerCase();
    if (value === "" || value === "llm") {
        return "llm";
    }
    if (value === "shadow") {
        return "shadow";
    }
    return "regex";
}
