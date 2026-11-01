import { firstNonEmpty } from "./parse";

export type UpstashRestConfig = {
    url: string;
    token: string;
};

const UPSTASH_TIMEOUT_MS = 500;

// Every Upstash client sits on a request path, so a failed call gets one short attempt.
export const upstashFailFastOptions = {
    // Not `retry: false`, which the SDK still sends twice.
    retry: { retries: 0 },
    // Must be a function. The SDK turns an aborted plain signal into a
    // successful response whose value is the abort reason.
    signal: () => AbortSignal.timeout(UPSTASH_TIMEOUT_MS),
};

export function getRedisUrl(): string | undefined {
    return firstNonEmpty(process.env.REDIS_URL);
}

export function getUpstashRestConfig(): UpstashRestConfig | undefined {
    const url = firstNonEmpty(process.env.UPSTASH_REDIS_REST_URL);
    const token = firstNonEmpty(process.env.UPSTASH_REDIS_REST_TOKEN);
    if (!url || !token) {
        return undefined;
    }
    return { url, token };
}
