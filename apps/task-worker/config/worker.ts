import { getOutboxPartitionConfig } from "@semantask/services/outbox.service";
import { firstNonEmpty, parsePositiveInt, parsePositiveNumber } from "./parse.js";

export const LEASE_MS_FALLBACK = 30_000;
export const POLL_MS_FALLBACK = 800;
export const BATCH_SIZE_FALLBACK = 10;
export const OUTBOX_MAX_ATTEMPTS_FALLBACK = 12;
export const OUTBOX_RETRY_JITTER_PCT_FALLBACK = 0.2;
export const RETRY_SCAN_INTERVAL_MS_FALLBACK = 5000;
export const RETRY_BATCH_SIZE_FALLBACK = 10;
export const RETRY_BASE_BACKOFF_MS_FALLBACK = 2000;
export const RETRY_MAX_BACKOFF_MS_FALLBACK = 300_000;
export const STUCK_DETECTION_INTERVAL_MS_FALLBACK = 60_000;
export const ARCHIVE_INTERVAL_MS_FALLBACK = 60 * 60 * 1000;
export const METRICS_PORT_FALLBACK = 9091;
export const SHUTDOWN_GRACE_MS_FALLBACK = 20_000;
export const AGENT_MAX_ITERATIONS_PLAN_FALLBACK = 5;
export const AGENT_MAX_ITERATIONS_PERSISTENT_FALLBACK = 8;
export const AGENT_TOOL_TIMEOUT_MS_FALLBACK = 60_000;
export const AGENT_ITERATION_TIMEOUT_MS_FALLBACK = 120_000;
export const AGENT_CANCEL_POLL_MS_FALLBACK = 250;
export const AGENT_CONFIDENCE_THRESHOLD_FALLBACK = 0.7;
export const SOCKET_SERVER_URL_FALLBACK = "http://localhost:3001";

export type StuckRemediationMode = "log" | "fail" | "retry";

export type WorkerRuntimeConfig = {
    isProduction: boolean;
    mongodbUri: string | undefined;
    redisUrl: string | undefined;
    allowNoRedis: boolean;
    socketServerUrl: string;
    persistentLoopEnabled: boolean;
    workerId: string | undefined;
    metricsPort: number;
    batchSize: number;
    pollMs: number;
    shutdownGraceMs: number;
    leaseMs: number;
    outboxMaxAttempts: number;
    outboxRetryJitterPct: number;
    outboxArchiveIntervalMs: number;
    outboxPartition: { count: number; id: number };
    retryScanIntervalMs: number;
    retryBatchSize: number;
    retryBaseBackoffMs: number;
    retryMaxBackoffMs: number;
    stuckDetectionIntervalMs: number;
    stuckHeartbeatMs: number | undefined;
    stuckRemediation: StuckRemediationMode;
    agentMaxIterationsPlan: number;
    agentMaxIterationsPersistent: number;
    agentToolTimeoutMs: number;
    agentIterationTimeoutMs: number;
    agentCancelPollMs: number;
    agentConfidenceThreshold: number;
};

export function getLeaseMs(): number {
    const parsed = parsePositiveNumber(process.env.TASK_LEASE_MS, LEASE_MS_FALLBACK);
    return Math.max(1000, parsed);
}

export function getStuckRemediationMode(): StuckRemediationMode {
    const raw = (process.env.TASK_STUCK_REMEDIATION || "log").trim().toLowerCase();
    if (raw === "fail" || raw === "retry") {
        return raw;
    }
    return "log";
}

export function getStuckHeartbeatMs(): number | undefined {
    const configured = Number(process.env.TASK_STUCK_HEARTBEAT_MS);
    if (Number.isFinite(configured) && configured > 0) {
        return configured;
    }
    return undefined;
}

export function getSocketServerUrl(): string {
    return firstNonEmpty(
        process.env.SOCKET_SERVER_URL,
        process.env.NEXT_PUBLIC_SOCKET_URL,
    ) ?? SOCKET_SERVER_URL_FALLBACK;
}

/** ioredis TCP URL only. `UPSTASH_REDIS_REST_URL` is web REST, not a Redis protocol URL. */
export function getRedisUrl(): string | undefined {
    return firstNonEmpty(process.env.REDIS_URL);
}

export function getWorkerRuntimeConfig(): WorkerRuntimeConfig {
    const jitter = Number(process.env.OUTBOX_RETRY_JITTER_PCT || OUTBOX_RETRY_JITTER_PCT_FALLBACK);
    const confidence = Number(process.env.TASK_AGENT_CONFIDENCE_THRESHOLD ?? AGENT_CONFIDENCE_THRESHOLD_FALLBACK);
    const cancelPoll = Number(process.env.TASK_CANCEL_POLL_MS || AGENT_CANCEL_POLL_MS_FALLBACK);

    return {
        isProduction: process.env.NODE_ENV === "production",
        mongodbUri: firstNonEmpty(process.env.MONGODB_URI),
        redisUrl: getRedisUrl(),
        allowNoRedis: process.env.TASK_WORKER_ALLOW_NO_REDIS === "1",
        socketServerUrl: getSocketServerUrl(),
        persistentLoopEnabled: process.env.TASK_AGENT_PERSISTENT_LOOP_ENABLED === "true",
        workerId: firstNonEmpty(process.env.TASK_WORKER_ID),
        metricsPort: parsePositiveInt(process.env.METRICS_PORT, METRICS_PORT_FALLBACK),
        batchSize: parsePositiveInt(process.env.TASK_WORKER_BATCH_SIZE, BATCH_SIZE_FALLBACK),
        pollMs: parsePositiveNumber(process.env.TASK_WORKER_POLL_MS, POLL_MS_FALLBACK),
        shutdownGraceMs: parsePositiveNumber(
            process.env.TASK_WORKER_SHUTDOWN_GRACE_MS,
            SHUTDOWN_GRACE_MS_FALLBACK,
        ),
        leaseMs: getLeaseMs(),
        outboxMaxAttempts: parsePositiveInt(
            process.env.OUTBOX_MAX_ATTEMPTS,
            OUTBOX_MAX_ATTEMPTS_FALLBACK,
        ),
        outboxRetryJitterPct: Number.isFinite(jitter) ? jitter : OUTBOX_RETRY_JITTER_PCT_FALLBACK,
        outboxArchiveIntervalMs: parsePositiveNumber(
            process.env.OUTBOX_ARCHIVE_INTERVAL_MS,
            ARCHIVE_INTERVAL_MS_FALLBACK,
        ),
        outboxPartition: getOutboxPartitionConfig(),
        retryScanIntervalMs: parsePositiveNumber(
            process.env.TASK_RETRY_SCAN_INTERVAL_MS,
            RETRY_SCAN_INTERVAL_MS_FALLBACK,
        ),
        retryBatchSize: parsePositiveInt(process.env.TASK_RETRY_BATCH_SIZE, RETRY_BATCH_SIZE_FALLBACK),
        retryBaseBackoffMs: parsePositiveNumber(
            process.env.TASK_RETRY_BASE_BACKOFF_MS,
            RETRY_BASE_BACKOFF_MS_FALLBACK,
        ),
        retryMaxBackoffMs: parsePositiveNumber(
            process.env.TASK_RETRY_MAX_BACKOFF_MS,
            RETRY_MAX_BACKOFF_MS_FALLBACK,
        ),
        stuckDetectionIntervalMs: parsePositiveNumber(
            process.env.TASK_STUCK_DETECTION_INTERVAL_MS,
            STUCK_DETECTION_INTERVAL_MS_FALLBACK,
        ),
        stuckHeartbeatMs: getStuckHeartbeatMs(),
        stuckRemediation: getStuckRemediationMode(),
        agentMaxIterationsPlan: Math.max(
            1,
            Number(process.env.TASK_AGENT_MAX_ITERATIONS || AGENT_MAX_ITERATIONS_PLAN_FALLBACK),
        ),
        agentMaxIterationsPersistent: Math.max(
            1,
            Number(process.env.TASK_AGENT_MAX_ITERATIONS || AGENT_MAX_ITERATIONS_PERSISTENT_FALLBACK),
        ),
        agentToolTimeoutMs: (() => {
            const parsed = Number(process.env.TASK_AGENT_TOOL_TIMEOUT_MS || AGENT_TOOL_TIMEOUT_MS_FALLBACK);
            if (!Number.isFinite(parsed) || parsed <= 0) {
                return AGENT_TOOL_TIMEOUT_MS_FALLBACK;
            }
            return Math.max(1000, parsed);
        })(),
        agentIterationTimeoutMs: Math.max(
            1000,
            Number(process.env.TASK_AGENT_ITERATION_TIMEOUT_MS || AGENT_ITERATION_TIMEOUT_MS_FALLBACK),
        ),
        agentCancelPollMs: Number.isFinite(cancelPoll)
            ? Math.max(100, Math.min(2000, cancelPoll))
            : AGENT_CANCEL_POLL_MS_FALLBACK,
        agentConfidenceThreshold: Number.isNaN(confidence)
            ? AGENT_CONFIDENCE_THRESHOLD_FALLBACK
            : Math.max(0, Math.min(1, confidence)),
    };
}
