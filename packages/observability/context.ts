import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/** Mirror of `@semantask/types` constant — kept here so apps can import one package. */
export const CORRELATION_ID_HEADER = "x-correlation-id";

export type ObservabilityContext = {
    correlationId?: string;
    runId?: string;
    taskId?: string;
    traceparent?: string;
};

const storage = new AsyncLocalStorage<ObservabilityContext>();

export function getObservabilityContext(): ObservabilityContext {
    return storage.getStore() ?? {};
}

export function getCorrelationId(): string | undefined {
    return getObservabilityContext().correlationId;
}

export function ensureCorrelationId(existing?: string | null): string {
    const current = existing?.trim() || getCorrelationId();
    if (current) {
        return current;
    }
    return randomUUID();
}

export function runWithObservabilityContext<T>(
    context: ObservabilityContext,
    fn: () => T
): T {
    const parent = getObservabilityContext();
    return storage.run(
        {
            ...parent,
            ...context,
            correlationId: context.correlationId ?? parent.correlationId,
        },
        fn
    );
}

export async function runWithObservabilityContextAsync<T>(
    context: ObservabilityContext,
    fn: () => Promise<T>
): Promise<T> {
    const parent = getObservabilityContext();
    return storage.run(
        {
            ...parent,
            ...context,
            correlationId: context.correlationId ?? parent.correlationId,
        },
        fn
    );
}

export function mergeCorrelationIntoPayload(
    payload: Record<string, unknown>,
    correlationId?: string | null
): Record<string, unknown> {
    const id = ensureCorrelationId(
        (typeof payload.correlationId === "string" ? payload.correlationId : null)
            ?? correlationId
    );
    return {
        ...payload,
        correlationId: id,
    };
}

export function correlationIdFromPayload(payload: Record<string, unknown> | null | undefined): string | undefined {
    if (!payload || typeof payload !== "object") {
        return undefined;
    }
    return typeof payload.correlationId === "string" && payload.correlationId.trim()
        ? payload.correlationId.trim()
        : undefined;
}
