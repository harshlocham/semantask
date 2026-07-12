import { createLogger } from "@semantask/observability/logger";

export type ExecutionLogLevel = "info" | "warn" | "error";

export interface ExecutionLogFields {
    event: string;
    workerId?: string;
    runId?: string;
    taskId?: string;
    leaseOwner?: string;
    durationMs?: number;
    phase?: string;
    toolName?: string;
    retryCount?: number;
    category?: string;
    error?: string;
    lifecycleState?: string;
    executionStateKind?: string;
    projectedLifecycleState?: string;
    source?: string;
    [key: string]: unknown;
}

const logger = createLogger("task-worker");

export function logExecution(level: ExecutionLogLevel, fields: ExecutionLogFields): void {
    if (level === "error") {
        logger.error(fields);
        return;
    }
    if (level === "warn") {
        logger.warn(fields);
        return;
    }
    logger.info(fields);
}
