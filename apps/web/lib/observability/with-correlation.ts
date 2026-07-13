import {
    CORRELATION_ID_HEADER,
    ensureCorrelationId,
    runWithObservabilityContextAsync,
} from "@semantask/observability";

/**
 * Bind ALS correlation for a web/API request.
 * Prefer incoming `x-correlation-id`; otherwise mint a new UUID.
 */
export async function withRequestCorrelation<T>(
    request: Request,
    fn: () => Promise<T>
): Promise<T> {
    const incoming = request.headers.get(CORRELATION_ID_HEADER);
    const correlationId = ensureCorrelationId(incoming);
    return runWithObservabilityContextAsync({ correlationId }, fn);
}
