import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const EMAIL = "user@example.com";
const STATE = { id: "user-1", email: EMAIL, role: "user" as const, tokenVersion: 0 };
const TEST_TIMEOUT_MS = 15_000;

type Respond = (command: string[]) => unknown;

const REJECT = Symbol("reject");
const rejectAll: Respond = () => REJECT;

const servers: Server[] = [];
let warnings: Record<string, unknown>[] = [];

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// Answers like Upstash, and fails any command the test answers with REJECT.
function scriptedHost(respond: Respond): Promise<string> {
    return listen((req, res) => {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk;
        });
        req.on("end", () => {
            const isPipeline = req.url?.endsWith("/pipeline");
            const parsed = JSON.parse(body) as string[] | string[][];
            const batch = (isPipeline ? parsed : [parsed]) as string[][];
            const answers = batch.map(respond);
            res.setHeader("content-type", "application/json");
            if (answers.includes(REJECT)) {
                res.statusCode = 401;
                res.end(JSON.stringify({ error: "WRONGPASS invalid token" }));
                return;
            }
            const results = answers.map((result) => ({
                result: typeof result === "string" ? Buffer.from(result).toString("base64") : result,
            }));
            res.end(JSON.stringify(isPipeline ? results : results[0]));
        });
    });
}

function hangingHost(): Promise<string> {
    return listen(() => undefined);
}

function commandName(command: string[]): string {
    return command[0].toLowerCase();
}

async function load(url: string) {
    jest.resetModules();
    process.env.UPSTASH_REDIS_REST_URL = url;
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    const limiter = await import("@/lib/utils/rateLimiter");
    const cache = await import("@/lib/utils/auth/userStateCache");
    return { ...limiter, ...cache };
}

beforeEach(() => {
    warnings = [];
    jest.spyOn(console, "warn").mockImplementation((line: unknown) => {
        warnings.push(JSON.parse(String(line)) as Record<string, unknown>);
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
    })));
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

describe("Upstash fallback warning", () => {
    it.each<[string, string, Respond, (mod: Awaited<ReturnType<typeof load>>) => Promise<unknown>]>([
        ["rate_limiter", "limit", rejectAll, (mod) => mod.authRegisterRateLimiter.limit("client")],
        [
            "rate_limiter",
            "block_check",
            (command) => (commandName(command) === "get" ? REJECT : [1, 3]),
            (mod) => mod.enforceAuthRateLimit({ endpoint: "register", ipAddress: "203.0.113.1" }),
        ],
        [
            "rate_limiter",
            "backoff_write",
            (command) => {
                if (commandName(command) === "get") return null;
                return commandName(command) === "evalsha" ? [4, 3] : REJECT;
            },
            (mod) => mod.enforceAuthRateLimit({ endpoint: "register", ipAddress: "203.0.113.1" }),
        ],
        ["user_state_cache", "get", rejectAll, (mod) => mod.getCachedUserState(STATE.id)],
        ["user_state_cache", "set", rejectAll, (mod) => mod.setCachedUserState(STATE)],
        ["user_state_cache", "del", rejectAll, (mod) => mod.clearCachedUserState(STATE.id)],
    ])("reports %s %s", async (source, operation, respond, run) => {
        const mod = await load(await scriptedHost(respond));

        await run(mod);

        expect(warnings).toEqual([expect.objectContaining({
            level: "warn",
            event: "upstash.fallback",
            source,
            operation,
            reason: "error",
            errorName: "UpstashError",
        })]);
    }, TEST_TIMEOUT_MS);

    it("reports a timeout as a timeout", async () => {
        const { authRegisterRateLimiter } = await load(await hangingHost());

        await authRegisterRateLimiter.limit("client");

        expect(warnings).toEqual([expect.objectContaining({ source: "rate_limiter", reason: "timeout" })]);
    }, TEST_TIMEOUT_MS);

    it("reports the network error code of a dead host", async () => {
        const url = await listen(() => undefined);
        await new Promise((resolve) => servers.pop()?.close(resolve));
        const { authRegisterRateLimiter } = await load(url);

        await authRegisterRateLimiter.limit("client");

        expect(warnings).toEqual([expect.objectContaining({ reason: "error", errorCode: "ECONNREFUSED" })]);
    }, TEST_TIMEOUT_MS);

    it("warns once a minute for each source", async () => {
        let now = Date.now();
        jest.spyOn(Date, "now").mockImplementation(() => now);
        const { authLogoutRateLimiter, getCachedUserState } = await load(await scriptedHost(rejectAll));

        await authLogoutRateLimiter.limit("client");
        await authLogoutRateLimiter.limit("client");
        await getCachedUserState(STATE.id);
        await getCachedUserState(STATE.id);
        expect(warnings.map((warning) => warning.source)).toEqual(["rate_limiter", "user_state_cache"]);

        now += 59_999;
        await authLogoutRateLimiter.limit("client");
        expect(warnings).toHaveLength(2);

        now += 1;
        await authLogoutRateLimiter.limit("client");
        await authLogoutRateLimiter.limit("client");
        expect(warnings.map((warning) => warning.source)).toEqual([
            "rate_limiter",
            "user_state_cache",
            "rate_limiter",
        ]);
    }, TEST_TIMEOUT_MS);

    it("never logs the command, which holds emails and user state", async () => {
        const { enforceAuthRateLimit, setCachedUserState } = await load(await scriptedHost(rejectAll));

        await enforceAuthRateLimit({ endpoint: "login", ipAddress: "203.0.113.1", identifier: EMAIL });
        await setCachedUserState(STATE);

        expect(warnings).toHaveLength(2);
        expect(JSON.stringify(warnings)).not.toContain(EMAIL);
        expect(JSON.stringify(warnings)).not.toContain("203.0.113.1");
    }, TEST_TIMEOUT_MS);

    it("stays quiet when the host is healthy", async () => {
        const mod = await load(await scriptedHost((command) => {
            if (commandName(command) === "evalsha") return [1, 3];
            if (commandName(command) === "get") return null;
            return "OK";
        }));

        await mod.enforceAuthRateLimit({ endpoint: "register", ipAddress: "203.0.113.1" });
        await mod.setCachedUserState(STATE);
        await mod.clearCachedUserState(STATE.id);
        await mod.getCachedUserState(STATE.id);

        expect(warnings).toEqual([]);
    }, TEST_TIMEOUT_MS);

    it("does not report an unusable cache entry as an Upstash failure", async () => {
        const { getCachedUserState } = await load(await scriptedHost(() => JSON.stringify(STATE)));

        // The SDK deserializes this entry, so JSON.parse throws and it reads as a miss.
        await expect(getCachedUserState(STATE.id)).resolves.toBeNull();

        expect(warnings).toEqual([]);
    }, TEST_TIMEOUT_MS);
});
