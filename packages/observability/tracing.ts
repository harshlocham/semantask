import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { trace, context, SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api";

let sdkStarted = false;
let sdk: NodeSDK | null = null;

export function isTracingEnabled(): boolean {
    return Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim());
}

export function startTracing(serviceName: string): void {
    if (sdkStarted || !isTracingEnabled()) {
        return;
    }

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT!.trim();
    sdk = new NodeSDK({
        resource: new Resource({
            [ATTR_SERVICE_NAME]: serviceName,
        }),
        traceExporter: new OTLPTraceExporter({
            url: endpoint.endsWith("/v1/traces")
                ? endpoint
                : `${endpoint.replace(/\/$/, "")}/v1/traces`,
        }),
    });

    sdk.start();
    sdkStarted = true;
}

export async function shutdownTracing(): Promise<void> {
    if (sdk) {
        await sdk.shutdown();
        sdk = null;
        sdkStarted = false;
    }
}

export function getTracer(name = "semantask"): Tracer {
    return trace.getTracer(name);
}

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
