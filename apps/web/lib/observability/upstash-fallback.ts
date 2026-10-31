import { createLogger } from "@semantask/observability/logger";

export type UpstashFallbackSource = "rate_limiter" | "user_state_cache";

const WARNING_INTERVAL_MS = 60_000;

const logger = createLogger("web-upstash");
// Per source, so a failing cache cannot hide that rate limits have gone local.
const lastWarningAt = new Map<UpstashFallbackSource, number>();

export function warnUpstashFallback(source: UpstashFallbackSource, operation: string, error: unknown): void {
    const now = Date.now();
    const last = lastWarningAt.get(source);
    if (last !== undefined && now - last < WARNING_INTERVAL_MS) return;
    lastWarningAt.set(source, now);

    // Never log the message. Upstash quotes the command in it, which holds emails,
    // IP addresses, and user state.
    const failure = error as { name?: unknown; cause?: { code?: unknown } } | null | undefined;
    const errorName = typeof failure?.name === "string" ? failure.name : "unknown";
    const errorCode = failure?.cause?.code;

    logger.warn({
        event: "upstash.fallback",
        source,
        operation,
        reason: errorName === "TimeoutError" || errorName === "AbortError" ? "timeout" : "error",
        errorName,
        ...(typeof errorCode === "string" ? { errorCode } : {}),
    });
}
