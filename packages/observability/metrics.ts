import {
    Counter,
    Gauge,
    Histogram,
    Registry,
    collectDefaultMetrics,
} from "prom-client";

export const metricsRegistry = new Registry();

let defaultsRegistered = false;

export function ensureDefaultMetrics(serviceName: string): void {
    if (defaultsRegistered) {
        return;
    }
    collectDefaultMetrics({
        register: metricsRegistry,
        labels: { service: serviceName },
    });
    defaultsRegistered = true;
}

export const outboxPendingGauge = new Gauge({
    name: "outbox_pending",
    help: "Count of pending/failed outbox events available to claim",
    labelNames: ["topic"] as const,
    registers: [metricsRegistry],
});

export const outboxProcessingGauge = new Gauge({
    name: "outbox_processing",
    help: "Count of outbox events currently processing",
    labelNames: ["topic"] as const,
    registers: [metricsRegistry],
});

export const outboxLagSecondsGauge = new Gauge({
    name: "outbox_lag_seconds",
    help: "Age in seconds of the oldest pending outbox event",
    labelNames: ["topic"] as const,
    registers: [metricsRegistry],
});

export const taskExecutionCounter = new Counter({
    name: "task_execution_total",
    help: "Task execution outcomes",
    labelNames: ["outcome"] as const,
    registers: [metricsRegistry],
});

export const taskStuckDetectedCounter = new Counter({
    name: "task_stuck_detected_total",
    help: "Stuck task detections",
    labelNames: ["remediation"] as const,
    registers: [metricsRegistry],
});

export const llmRequestDurationSeconds = new Histogram({
    name: "llm_request_duration_seconds",
    help: "LLM request latency in seconds",
    labelNames: ["provider"] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    registers: [metricsRegistry],
});

export const llmEventCounter = new Counter({
    name: "llm_events_total",
    help: "LLM provider events",
    labelNames: ["provider", "event"] as const,
    registers: [metricsRegistry],
});

export async function renderPrometheusMetrics(): Promise<string> {
    return metricsRegistry.metrics();
}

export function prometheusContentType(): string {
    return metricsRegistry.contentType;
}
