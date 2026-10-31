import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";
import { getUpstashRestConfig, upstashFailFastOptions } from "@/lib/config/redis";

type RateLimitResult = {
    success: boolean;
    remaining: number;
    reset: number;
};

type Bucket = {
    count: number;
    resetAt: number;
};

class InMemoryRateLimiter {
    private readonly windowMs: number;
    private readonly max: number;
    private readonly buckets = new Map<string, Bucket>();

    constructor(windowMs: number, max: number) {
        this.windowMs = windowMs;
        this.max = max;
    }

    async limit(key: string): Promise<RateLimitResult> {
        const now = Date.now();
        const existing = this.buckets.get(key);

        if (!existing || existing.resetAt <= now) {
            const resetAt = now + this.windowMs;
            this.buckets.set(key, { count: 1, resetAt });
            return { success: true, remaining: this.max - 1, reset: resetAt };
        }

        existing.count += 1;
        this.buckets.set(key, existing);

        return {
            success: existing.count <= this.max,
            remaining: Math.max(this.max - existing.count, 0),
            reset: existing.resetAt,
        };
    }
}

const upstash = getUpstashRestConfig();
const upstashUrl = upstash?.url;
const upstashToken = upstash?.token;

let upstashRedisClient: Redis | null = null;
if (upstashUrl && upstashToken) {
    upstashRedisClient = new Redis({
        url: upstashUrl,
        token: upstashToken,
        ...upstashFailFastOptions,
    });
}

class HybridRateLimiter {
    private readonly inMemoryLimiter: InMemoryRateLimiter;
    private readonly upstashLimiter: Ratelimit | null;

    constructor(prefix: string, windowMs: number, max: number) {
        this.inMemoryLimiter = new InMemoryRateLimiter(windowMs, max);

        if (!upstashRedisClient) {
            this.upstashLimiter = null;
            return;
        }

        const windowSeconds = Math.max(Math.ceil(windowMs / 1000), 1);
        this.upstashLimiter = new Ratelimit({
            redis: upstashRedisClient,
            limiter: Ratelimit.fixedWindow(max, `${windowSeconds} s`),
            prefix,
            // Off, because the library's own timeout allows the request. The
            // client's timeout throws instead, which reaches the fallback below.
            timeout: 0,
        });
    }

    async limit(key: string): Promise<RateLimitResult> {
        if (!this.upstashLimiter) {
            return this.inMemoryLimiter.limit(key);
        }

        try {
            const result = await this.upstashLimiter.limit(key);
            return {
                success: result.success,
                remaining: result.remaining,
                reset: result.reset,
            };
        } catch {
            // Keep enforcing a limit locally so auth endpoints stay available and
            // throttled if the Redis network path is down. Counts are per process.
            return this.inMemoryLimiter.limit(key);
        }
    }
}

export type AuthRateLimitEndpoint = "login" | "register" | "refresh" | "logout" | "change_password" | "revoke_tokens";

export type AuthRateLimitDecision = {
    allowed: boolean;
    endpoint: AuthRateLimitEndpoint;
    reason?: "temporarily_blocked" | "rate_limited";
    retryAfterSeconds?: number;
};

type LocalBackoffState = {
    violations: number;
    blockUntil: number;
    expireAt: number;
};

const localBackoffState = new Map<string, LocalBackoffState>();
const BACKOFF_BASE_SECONDS = 30;
const BACKOFF_MAX_SECONDS = 15 * 60;
const BACKOFF_TRACK_SECONDS = 15 * 60;

function normalizeRateLimitIdentifier(identifier?: string): string | null {
    if (!identifier) return null;
    const normalized = identifier.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
}

function authLimiterFor(endpoint: AuthRateLimitEndpoint): HybridRateLimiter {
    switch (endpoint) {
        case "login":
            return authLoginRateLimiter;
        case "register":
            return authRegisterRateLimiter;
        case "refresh":
            return authRefreshRateLimiter;
        case "logout":
            return authLogoutRateLimiter;
        case "change_password":
            return authChangePasswordRateLimiter;
        case "revoke_tokens":
            return authRevokeTokensRateLimiter;
        default:
            return authRateLimiter;
    }
}

function rateLimitKey(endpoint: AuthRateLimitEndpoint, scope: "ip" | "id", value: string): string {
    return `auth:${endpoint}:${scope}:${value}`;
}

async function getRemoteBlockUntil(key: string): Promise<number | null> {
    if (!upstashRedisClient) return null;

    try {
        const raw = await upstashRedisClient.get<string>(`rl:block:${key}`);
        if (!raw) return null;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed <= Date.now()) return null;
        return parsed;
    } catch {
        return null;
    }
}

function getLocalBackoffStateKey(key: string): string {
    return `local:block:${key}`;
}

function cleanupLocalBackoff(stateKey: string) {
    const existing = localBackoffState.get(stateKey);
    if (!existing) return;
    if (existing.expireAt <= Date.now()) {
        localBackoffState.delete(stateKey);
    }
}

async function getBlockUntil(key: string): Promise<number | null> {
    const remote = await getRemoteBlockUntil(key);
    if (remote) return remote;

    const stateKey = getLocalBackoffStateKey(key);
    cleanupLocalBackoff(stateKey);
    const local = localBackoffState.get(stateKey);
    if (!local) return null;
    if (local.blockUntil <= Date.now()) return null;
    return local.blockUntil;
}

async function registerBackoffViolation(key: string): Promise<number> {
    if (upstashRedisClient) {
        try {
            const violationsKey = `rl:viol:${key}`;
            const blockKey = `rl:block:${key}`;

            const violations = await upstashRedisClient.incr(violationsKey);
            if (violations === 1) {
                await upstashRedisClient.expire(violationsKey, BACKOFF_TRACK_SECONDS);
            }

            const blockSeconds = Math.min(
                BACKOFF_BASE_SECONDS * Math.pow(2, Math.max(violations - 1, 0)),
                BACKOFF_MAX_SECONDS
            );
            const blockUntil = Date.now() + blockSeconds * 1000;

            await upstashRedisClient.set(blockKey, String(blockUntil), { ex: blockSeconds });
            return blockUntil;
        } catch {
            // Fall through to local backoff.
        }
    }

    const stateKey = getLocalBackoffStateKey(key);
    cleanupLocalBackoff(stateKey);
    const existing = localBackoffState.get(stateKey);
    const nextViolations = (existing?.violations || 0) + 1;
    const blockSeconds = Math.min(
        BACKOFF_BASE_SECONDS * Math.pow(2, Math.max(nextViolations - 1, 0)),
        BACKOFF_MAX_SECONDS
    );
    const blockUntil = Date.now() + blockSeconds * 1000;

    localBackoffState.set(stateKey, {
        violations: nextViolations,
        blockUntil,
        expireAt: Date.now() + BACKOFF_TRACK_SECONDS * 1000,
    });

    return blockUntil;
}

function computeRetrySeconds(blockUntil?: number, resetAt?: number): number {
    const until = Math.max(blockUntil || 0, resetAt || 0);
    if (!until) return 60;
    const seconds = Math.ceil((until - Date.now()) / 1000);
    return Math.max(1, seconds);
}

export async function enforceAuthRateLimit({
    endpoint,
    ipAddress,
    identifier,
    enableBackoff = true,
}: {
    endpoint: AuthRateLimitEndpoint;
    ipAddress: string;
    identifier?: string;
    enableBackoff?: boolean;
}): Promise<AuthRateLimitDecision> {
    const limiter = authLimiterFor(endpoint);
    const ipKey = rateLimitKey(endpoint, "ip", ipAddress || "unknown");
    const normalizedId = normalizeRateLimitIdentifier(identifier);
    const idKey = normalizedId ? rateLimitKey(endpoint, "id", normalizedId) : null;

    const [ipBlockedUntil, idBlockedUntil] = await Promise.all([
        getBlockUntil(ipKey),
        idKey ? getBlockUntil(idKey) : Promise.resolve(null),
    ]);

    const activeBlockUntil = Math.max(ipBlockedUntil || 0, idBlockedUntil || 0);
    if (activeBlockUntil > Date.now()) {
        return {
            allowed: false,
            endpoint,
            reason: "temporarily_blocked",
            retryAfterSeconds: computeRetrySeconds(activeBlockUntil),
        };
    }

    const ipResult = await limiter.limit(ipKey);
    const idResult = idKey ? await limiter.limit(idKey) : null;

    const denied = !ipResult.success || (idResult ? !idResult.success : false);
    if (!denied) {
        return { allowed: true, endpoint };
    }

    let blockUntil: number | undefined;
    if (enableBackoff) {
        const blockTargets = [
            ...(!ipResult.success ? [ipKey] : []),
            ...(idResult && !idResult.success && idKey ? [idKey] : []),
        ];

        const blockResults = await Promise.all(blockTargets.map((key) => registerBackoffViolation(key)));
        blockUntil = blockResults.length > 0 ? Math.max(...blockResults) : undefined;
    }

    return {
        allowed: false,
        endpoint,
        reason: "rate_limited",
        retryAfterSeconds: computeRetrySeconds(
            blockUntil,
            Math.max(ipResult.reset || 0, idResult?.reset || 0)
        ),
    };
}

function tooManyRequestsMessage(endpoint: AuthRateLimitEndpoint): string {
    switch (endpoint) {
        case "login":
            return "Too many login attempts. Try again later.";
        case "register":
            return "Too many registration attempts. Try again later.";
        case "change_password":
            return "Too many password change attempts. Try again later.";
        case "revoke_tokens":
            return "Too many token revocation attempts. Try again later.";
        case "refresh":
            return "Too many refresh attempts. Try again later.";
        case "logout":
            return "Too many logout attempts. Try again later.";
        default:
            return "Too many requests. Try again later.";
    }
}

export function authRateLimitResponse(decision: AuthRateLimitDecision) {
    const retryAfter = Math.max(1, decision.retryAfterSeconds || 60);

    return NextResponse.json(
        {
            success: false,
            error: tooManyRequestsMessage(decision.endpoint),
            code: "AUTH_RATE_LIMITED",
            endpoint: decision.endpoint,
            reason: decision.reason || "rate_limited",
            retryAfterSeconds: retryAfter,
        },
        {
            status: 429,
            headers: {
                "Retry-After": String(retryAfter),
            },
        }
    );
}

export const authRateLimiter = new HybridRateLimiter("rl:auth", 60_000, 5);
export const authLoginRateLimiter = new HybridRateLimiter("rl:auth:login", 60_000, 5);
export const authRegisterRateLimiter = new HybridRateLimiter("rl:auth:register", 60_000, 3);
export const authRefreshRateLimiter = new HybridRateLimiter("rl:auth:refresh", 60_000, 3);
export const authLogoutRateLimiter = new HybridRateLimiter("rl:auth:logout", 60_000, 10);
export const authChangePasswordRateLimiter = new HybridRateLimiter("rl:auth:change-password", 60_000, 5);
export const authRevokeTokensRateLimiter = new HybridRateLimiter("rl:auth:revoke-tokens", 60_000, 10);
export const authGoogleCallbackRateLimiter = new HybridRateLimiter("rl:auth:google", 60_000, 20);
export const messageRateLimiter = new HybridRateLimiter("rl:message", 10_000, 20);
export const internalSocketAuthzRateLimiter = new HybridRateLimiter("rl:internal:socket-authz", 10_000, 80);
