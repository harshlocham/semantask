import type { Request, Response, NextFunction } from "express";
import {
    CORRELATION_ID_HEADER,
    createLogger,
    ensureCorrelationId,
    runWithObservabilityContext,
} from "@semantask/observability";

const logger = createLogger("socket");

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
    const correlationId = ensureCorrelationId(req.header(CORRELATION_ID_HEADER));
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    runWithObservabilityContext({ correlationId }, () => next());
}

export function logSocketEvent(
    level: "info" | "warn" | "error",
    fields: Record<string, unknown> & { event: string }
): void {
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
