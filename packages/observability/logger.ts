import {
    getObservabilityContext,
} from "./context.js";

export type LogLevel = "info" | "warn" | "error";

export type LogFields = Record<string, unknown> & {
    event?: string;
};

export type StructuredLogger = {
    info: (fields: LogFields) => void;
    warn: (fields: LogFields) => void;
    error: (fields: LogFields) => void;
};

function write(level: LogLevel, component: string, fields: LogFields): void {
    const ctx = getObservabilityContext();
    const line = JSON.stringify({
        level,
        ts: new Date().toISOString(),
        component,
        ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {}),
        ...(ctx.runId ? { runId: ctx.runId } : {}),
        ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
        ...fields,
    });

    if (level === "error") {
        console.error(line);
        return;
    }
    if (level === "warn") {
        console.warn(line);
        return;
    }
    console.info(line);
}

export function createLogger(component: string): StructuredLogger {
    return {
        info: (fields) => write("info", component, fields),
        warn: (fields) => write("warn", component, fields),
        error: (fields) => write("error", component, fields),
    };
}
