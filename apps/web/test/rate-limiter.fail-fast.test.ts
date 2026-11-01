import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

// Each Upstash call may wait out the 500ms timeout. The margins are for slow CI,
// and sit far below the 4.3s per call of the SDK's default retries.
const ONE_CALL_BUDGET_MS = 1_500;
// Block check, limiter, and violation write, or block check and two limiter calls.
const ENFORCE_BUDGET_MS = 3_000;
const TEST_TIMEOUT_MS = 30_000;

type CacheHost = { url: string; requests: () => number | null };

const servers: Server[] = [];

async function listen(handler: Parameters<typeof createServer>[1]): Promise<Server> {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    return server;
}

function urlOf(server: Server): string {
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function hangingHost(): Promise<CacheHost> {
    let requests = 0;
    const server = await listen(() => {
        requests += 1;
    });
    return { url: urlOf(server), requests: () => requests };
}

async function stallingHost(): Promise<CacheHost> {
    let requests = 0;
    const server = await listen((_req, res) => {
        requests += 1;
        res.setHeader("content-type", "application/json");
        res.write("[");
    });
    return { url: urlOf(server), requests: () => requests };
}

// The SDK retries network errors, so this is the host that counts retries.
async function droppingHost(): Promise<CacheHost> {
    let requests = 0;
    const server = await listen((req) => {
        requests += 1;
        req.socket.destroy();
    });
    return { url: urlOf(server), requests: () => requests };
}

async function rejectingHost(): Promise<CacheHost> {
    let requests = 0;
    const server = await listen((_req, res) => {
        requests += 1;
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "WRONGPASS invalid token" }));
    });
    return { url: urlOf(server), requests: () => requests };
}

async function refusingHost(): Promise<CacheHost> {
    const server = await listen(() => undefined);
    const url = urlOf(server);
    await new Promise((resolve) => server.close(resolve));
    return { url, requests: () => null };
}

async function unresolvableHost(): Promise<CacheHost> {
    return { url: "https://semantask-limiter-test.invalid", requests: () => null };
}

// Answers like Upstash, so the tests can show a healthy host still decides.
async function healthyHost(respond: (command: string[]) => unknown) {
    const commands: string[][] = [];
    const server = await listen((req, res) => {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk;
        });
        req.on("end", () => {
            const isPipeline = req.url?.endsWith("/pipeline");
            const parsed = JSON.parse(body) as string[] | string[][];
            const batch = (isPipeline ? parsed : [parsed]) as string[][];
            commands.push(...batch);
            const results = batch.map((command) => {
                const result = respond(command);
                return {
                    result: typeof result === "string" ? Buffer.from(result).toString("base64") : result,
                };
            });
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(isPipeline ? results : results[0]));
        });
    });
    return { url: urlOf(server), commands };
}

async function loadWithLimiterAt(url: string) {
    jest.resetModules();
    process.env.UPSTASH_REDIS_REST_URL = url;
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    return import("@/lib/utils/rateLimiter");
}

async function timed<T>(run: () => Promise<T>): Promise<{ value: T; elapsedMs: number }> {
    const startedAt = Date.now();
    const value = await run();
    return { value, elapsedMs: Date.now() - startedAt };
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
    })));
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

describe.each([
    ["never answers", hangingHost],
    ["stalls mid-response", stallingHost],
    ["drops the connection", droppingHost],
    ["rejects the request", rejectingHost],
    ["refuses connections", refusingHost],
    ["does not resolve", unresolvableHost],
])("rate limiter when the host %s", (_name, startHost) => {
    it("applies the limit in memory after one attempt per call", async () => {
        const host = await startHost();
        const { authRegisterRateLimiter } = await loadWithLimiterAt(host.url);

        const outcomes: boolean[] = [];
        for (let call = 0; call < 5; call += 1) {
            const { value, elapsedMs } = await timed(() => authRegisterRateLimiter.limit("client"));
            outcomes.push(value.success);
            expect(elapsedMs).toBeLessThan(ONE_CALL_BUDGET_MS);
        }

        expect(outcomes).toEqual([true, true, true, false, false]);
        expect(host.requests() ?? 5).toBe(5);
    }, TEST_TIMEOUT_MS);

    it("allows a login-shaped request within budget", async () => {
        const host = await startHost();
        const { enforceAuthRateLimit } = await loadWithLimiterAt(host.url);

        const { value, elapsedMs } = await timed(() => enforceAuthRateLimit({
            endpoint: "login",
            ipAddress: "203.0.113.1",
            identifier: "user@example.com",
        }));

        expect(value.allowed).toBe(true);
        expect(elapsedMs).toBeLessThan(ENFORCE_BUDGET_MS);
    }, TEST_TIMEOUT_MS);

    it("denies over the limit, then blocks, within budget", async () => {
        const host = await startHost();
        const { enforceAuthRateLimit } = await loadWithLimiterAt(host.url);

        const decisions = [];
        for (let call = 0; call < 5; call += 1) {
            const { value, elapsedMs } = await timed(() => enforceAuthRateLimit({
                endpoint: "register",
                ipAddress: "203.0.113.2",
            }));
            decisions.push(value);
            expect(elapsedMs).toBeLessThan(ENFORCE_BUDGET_MS);
        }

        expect(decisions.map((decision) => decision.allowed)).toEqual([true, true, true, false, false]);
        expect(decisions[3].reason).toBe("rate_limited");
        expect(decisions[4].reason).toBe("temporarily_blocked");
        expect(decisions[4].retryAfterSeconds).toBeGreaterThan(0);
    }, TEST_TIMEOUT_MS);
});

describe("rate limiter when the host never answers", () => {
    it("limits one identifier across different addresses", async () => {
        const host = await hangingHost();
        const { enforceAuthRateLimit } = await loadWithLimiterAt(host.url);

        const decisions = [];
        for (let call = 0; call < 4; call += 1) {
            decisions.push(await enforceAuthRateLimit({
                endpoint: "register",
                ipAddress: `203.0.113.${10 + call}`,
                identifier: "user@example.com",
            }));
        }

        expect(decisions.map((decision) => decision.allowed)).toEqual([true, true, true, false]);
    }, TEST_TIMEOUT_MS);
});

describe("rate limiter when the host is healthy", () => {
    it("uses the host's count, not the in-memory one", async () => {
        let used = 1;
        const host = await healthyHost((command) => (
            command[0].toLowerCase() === "evalsha" ? [used, 3] : null
        ));
        const { authRegisterRateLimiter } = await loadWithLimiterAt(host.url);

        const outcomes: boolean[] = [];
        for (let call = 0; call < 5; call += 1) {
            outcomes.push((await authRegisterRateLimiter.limit("under")).success);
        }
        used = 4;
        const over = await authRegisterRateLimiter.limit("over");

        expect(outcomes).toEqual([true, true, true, true, true]);
        expect(over.success).toBe(false);
    }, TEST_TIMEOUT_MS);

    it("reads blocks from the host and records violations there", async () => {
        const blockedUntil = Date.now() + 60_000;
        const host = await healthyHost((command) => {
            const [name, key] = [command[0].toLowerCase(), command[1]];
            if (name === "get") return key.includes("blocked") ? String(blockedUntil) : null;
            if (name === "evalsha") return [4, 3];
            if (name === "incr") return 1;
            if (name === "expire") return 1;
            return "OK";
        });
        const { enforceAuthRateLimit } = await loadWithLimiterAt(host.url);

        const blocked = await enforceAuthRateLimit({ endpoint: "register", ipAddress: "blocked" });
        const denied = await enforceAuthRateLimit({ endpoint: "register", ipAddress: "over" });

        expect(blocked.reason).toBe("temporarily_blocked");
        expect(denied.reason).toBe("rate_limited");
        expect(host.commands.some(([name, key]) => (
            name.toLowerCase() === "set" && key === "rl:block:auth:register:ip:over"
        ))).toBe(true);
    }, TEST_TIMEOUT_MS);
});
