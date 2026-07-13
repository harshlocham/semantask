import { trace, context, TraceFlags, SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api";

export function isTracingEnabled(): boolean {
    return Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim());
}

export function getTracer(name = "semantask"): Tracer {
    return trace.getTracer(name);
}

/** Restore a remote W3C `traceparent` into the active OTel context (no-op if invalid/missing). */
export function runWithRemoteTraceparent<T>(
    traceparent: string | undefined,
    fn: () => T
): T {
    if (!traceparent?.trim()) {
        return fn();
    }

    const parts = traceparent.trim().split("-");
    if (parts.length < 4 || parts[0] !== "00") {
        return fn();
    }

    const [, traceId, spanId, flagsHex] = parts;
    if (
        !/^[0-9a-f]{32}$/i.test(traceId)
        || !/^[0-9a-f]{16}$/i.test(spanId)
        || /^0+$/i.test(traceId)
        || /^0+$/i.test(spanId)
    ) {
        return fn();
    }

    const flags = Number.parseInt(flagsHex, 16);
    if (!Number.isFinite(flags)) {
        return fn();
    }

    const parentContext = trace.setSpanContext(context.active(), {
        traceId: traceId.toLowerCase(),
        spanId: spanId.toLowerCase(),
        traceFlags: flags & TraceFlags.SAMPLED,
        isRemote: true,
    });

    return context.with(parentContext, fn);
}

/**
 * Manual span helper using only `@opentelemetry/api` (safe for Next.js route bundles).
 * No-ops unless an SDK was started elsewhere (e.g. via `@semantask/observability/tracing`).
 */
export async function withSpan<T>(
    name: string,
    attributes: Record<string, string | number | boolean | undefined>,
    fn: (span: Span | undefined) => Promise<T>
): Promise<T> {
    if (!isTracingEnabled()) {
        return fn(undefined);
    }

    const tracer = getTracer();
    return tracer.startActiveSpan(name, async (span) => {
        try {
            for (const [key, value] of Object.entries(attributes)) {
                if (value !== undefined) {
                    span.setAttribute(key, value);
                }
            }
            const result = await fn(span);
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (error) {
            span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error instanceof Error ? error.message : String(error),
            });
            span.recordException(error instanceof Error ? error : new Error(String(error)));
            throw error;
        } finally {
            span.end();
        }
    });
}

export function getActiveTraceparent(): string | undefined {
    const span = trace.getActiveSpan();
    if (!span) {
        return undefined;
    }
    const spanContext = span.spanContext();
    if (!spanContext.traceId || !spanContext.spanId) {
        return undefined;
    }
    const flags = spanContext.traceFlags.toString(16).padStart(2, "0");
    return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

export { context, trace, SpanStatusCode };
