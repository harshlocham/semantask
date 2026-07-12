/**
 * OpenTelemetry SDK bootstrap (OTLP/HTTP only — no gRPC / sdk-node kitchen sink).
 * Safe for Next.js Node instrumentation when loaded with webpackIgnore.
 */
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { isTracingEnabled } from "./spans.js";

export {
    getActiveTraceparent,
    getTracer,
    isTracingEnabled,
    withSpan,
    context,
    trace,
    SpanStatusCode,
} from "./spans.js";

let provider: NodeTracerProvider | null = null;

export function startTracing(serviceName: string): void {
    if (provider || !isTracingEnabled()) {
        return;
    }

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT!.trim();
    const url = endpoint.endsWith("/v1/traces")
        ? endpoint
        : `${endpoint.replace(/\/$/, "")}/v1/traces`;

    const tracerProvider = new NodeTracerProvider({
        resource: new Resource({
            [ATTR_SERVICE_NAME]: serviceName,
        }),
    });

    tracerProvider.addSpanProcessor(
        new BatchSpanProcessor(new OTLPTraceExporter({ url }))
    );
    tracerProvider.register();
    provider = tracerProvider;
}

export async function shutdownTracing(): Promise<void> {
    if (provider) {
        await provider.shutdown();
        provider = null;
    }
}
