import { timingSafeEqual } from "node:crypto";

export const INTERNAL_SECRET_HEADER = "x-internal-secret";
export const CORRELATION_ID_HEADER = "x-correlation-id";

export type InternalBridgeTarget = "socket" | "web";

let correlationIdResolver: (() => string | undefined) | null = null;

/** Optional hook so apps can inject ALS-backed correlation without types→observability coupling. */
export function setCorrelationIdResolver(resolver: (() => string | undefined) | null): void {
    correlationIdResolver = resolver;
}

function readEnv(...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value) return value;
    }
    return undefined;
}

/**
 * Outbound secret used when calling a target service.
 * - socket: INTERNAL_SECRET_SOCKET → INTERNAL_SECRET (legacy)
 * - web: INTERNAL_SECRET_WORKER → INTERNAL_SECRET (legacy)
 */
export function getInternalSecretForTarget(target: InternalBridgeTarget): string {
    if (target === "socket") {
        const secret = readEnv("INTERNAL_SECRET_SOCKET", "INTERNAL_SECRET");
        if (!secret) {
            throw new Error("INTERNAL_SECRET_SOCKET (or legacy INTERNAL_SECRET) is not configured");
        }
        return secret;
    }

    const secret = readEnv("INTERNAL_SECRET_WORKER", "INTERNAL_SECRET");
    if (!secret) {
        throw new Error("INTERNAL_SECRET_WORKER (or legacy INTERNAL_SECRET) is not configured");
    }
    return secret;
}

/** @deprecated Prefer getInternalSecretForTarget("socket" | "web"). Falls back to INTERNAL_SECRET. */
export function getInternalSecret(): string {
    const secret = readEnv("INTERNAL_SECRET", "INTERNAL_SECRET_SOCKET", "INTERNAL_SECRET_WORKER");
    if (!secret) {
        throw new Error("INTERNAL_SECRET is not configured");
    }
    return secret;
}

function collectAcceptedSecrets(target: InternalBridgeTarget): string[] {
    const secrets: string[] = [];
    const push = (value: string | undefined) => {
        if (value && !secrets.includes(value)) {
            secrets.push(value);
        }
    };

    if (target === "socket") {
        // Socket accepts callers that hold the socket secret (web + worker).
        push(readEnv("INTERNAL_SECRET_SOCKET"));
        push(readEnv("INTERNAL_SECRET_SOCKET_PREVIOUS"));
        push(readEnv("INTERNAL_SECRET")); // legacy shared secret
    } else {
        // Web internal routes accept callers that hold the worker/web bridge secret (socket).
        push(readEnv("INTERNAL_SECRET_WORKER"));
        push(readEnv("INTERNAL_SECRET_WORKER_PREVIOUS"));
        push(readEnv("INTERNAL_SECRET")); // legacy shared secret
    }

    return secrets;
}

export function createInternalRequestHeaders(
    initOrTarget?: HeadersInit | InternalBridgeTarget,
    maybeInit?: HeadersInit
): Headers {
    let target: InternalBridgeTarget = "socket";
    let init: HeadersInit | undefined;

    if (initOrTarget === "socket" || initOrTarget === "web") {
        target = initOrTarget;
        init = maybeInit;
    } else {
        // Backward compatible: createInternalRequestHeaders() / createInternalRequestHeaders(init)
        // defaults to socket (most common caller path: web/worker → socket).
        init = initOrTarget;
        target = "socket";
    }

    const headers = new Headers(init);
    headers.set("Content-Type", "application/json");
    headers.set(INTERNAL_SECRET_HEADER, getInternalSecretForTarget(target));
    if (!headers.get(CORRELATION_ID_HEADER)) {
        const correlationId = correlationIdResolver?.();
        if (correlationId) {
            headers.set(CORRELATION_ID_HEADER, correlationId);
        }
    }
    return headers;
}

function secretsEqual(provided: string, expected: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) {
        return false;
    }
    return timingSafeEqual(a, b);
}

/**
 * Validate an inbound internal secret.
 * Pass `audience: "socket" | "web"` to accept the correct per-service secrets
 * (plus legacy INTERNAL_SECRET and optional *_PREVIOUS during rotation).
 */
export function hasValidInternalSecret(
    providedSecret: string | null | undefined,
    expectedSecretOrAudience?: string | InternalBridgeTarget
): boolean {
    if (!providedSecret) {
        return false;
    }

    if (expectedSecretOrAudience === "socket" || expectedSecretOrAudience === "web") {
        const accepted = collectAcceptedSecrets(expectedSecretOrAudience);
        if (accepted.length === 0) {
            return false;
        }
        return accepted.some((secret) => secretsEqual(providedSecret, secret));
    }

    const expected = typeof expectedSecretOrAudience === "string"
        ? expectedSecretOrAudience
        : getInternalSecret();

    return secretsEqual(providedSecret, expected);
}

/** True when at least one accepted secret is configured for the audience. */
export function assertInternalAudienceConfigured(audience: InternalBridgeTarget): void {
    const accepted = collectAcceptedSecrets(audience);
    if (accepted.length === 0) {
        throw new Error(
            audience === "socket"
                ? "INTERNAL_SECRET_SOCKET (or legacy INTERNAL_SECRET) is required"
                : "INTERNAL_SECRET_WORKER (or legacy INTERNAL_SECRET) is required"
        );
    }
}
