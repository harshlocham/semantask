import type { LLMProviderMetricSnapshot } from "./types.js";
import { llmEventCounter, llmRequestDurationSeconds } from "@semantask/observability/metrics";
import { getLLMUsageContext } from "./usage-context.js";
import { recordUsageEvent } from "@semantask/services/usage-event.service";

type MetricEvent =
    | { provider: string; event: "request" }
    | { provider: string; event: "success"; latencyMs: number }
    | { provider: string; event: "timeout" }
    | { provider: string; event: "fallback" }
    | { provider: string; event: "malformed_response" }
    | { provider: string; event: "repair" };

type MutableSnapshot = LLMProviderMetricSnapshot & { successCount: number };

const snapshots = new Map<string, MutableSnapshot>();

function getOrCreate(provider: string): MutableSnapshot {
    const existing = snapshots.get(provider);
    if (existing) {
        return existing;
    }

    const created: MutableSnapshot = {
        provider,
        requestCount: 0,
        successCount: 0,
        timeoutCount: 0,
        fallbackCount: 0,
        malformedResponseCount: 0,
        repairCount: 0,
        totalLatencyMs: 0,
        lastRequestAt: undefined,
    };

    snapshots.set(provider, created);
    return created;
}

export function recordLLMProviderMetric(event: MetricEvent) {
    const snapshot = getOrCreate(event.provider);

    llmEventCounter.inc({ provider: event.provider, event: event.event });
    if (event.event === "success") {
        llmRequestDurationSeconds.observe({ provider: event.provider }, event.latencyMs / 1000);
    }

    if (event.event === "request") {
        snapshot.requestCount += 1;
        snapshot.lastRequestAt = new Date().toISOString();
        return;
    }

    if (event.event === "success") {
        snapshot.successCount += 1;
        snapshot.totalLatencyMs += event.latencyMs;
        return;
    }

    if (event.event === "timeout") snapshot.timeoutCount += 1;
    if (event.event === "fallback") snapshot.fallbackCount += 1;
    if (event.event === "malformed_response") snapshot.malformedResponseCount += 1;
    if (event.event === "repair") snapshot.repairCount += 1;
}

/** Persist token usage when an LLM call succeeds (best-effort). */
export function persistLLMUsage(usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    model?: string | null;
} | null | undefined): void {
    if (!usage) return;

    const context = getLLMUsageContext();
    // Only persist when the worker wrapped the call in runWithLLMUsageContext
    // with attribution. Unit tests call providers without that store; writing
    // anyway would open mongoose (when MONGODB_URI is set, e.g. CI) and leave
    // the connection open so the Node test runner never exits.
    if (!context?.organizationId && !context?.userId && !context?.taskId) {
        return;
    }

    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens
        ?? Math.max(0, (usage.totalTokens ?? 0) - inputTokens);

    void recordUsageEvent({
        organizationId: context.organizationId ?? null,
        userId: context.userId ?? null,
        taskId: context.taskId ?? null,
        inputTokens,
        outputTokens,
        model: usage.model ?? null,
    });
}

export function getLLMProviderMetricsSnapshot(provider: string): LLMProviderMetricSnapshot {
    return { ...getOrCreate(provider) };
}

export function getAllLLMProviderMetricsSnapshots(): LLMProviderMetricSnapshot[] {
    return [...snapshots.values()].map((entry) => ({ ...entry }));
}

export function resetLLMProviderMetrics() {
    snapshots.clear();
}
