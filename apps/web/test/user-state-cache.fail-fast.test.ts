import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

const findById = jest.fn();
const USER_ID = "64b000000000000000000001";
const STATE = {
    id: USER_ID,
    email: "user@example.com",
    role: "user" as const,
    tokenVersion: 0,
};

jest.mock("next/headers", () => ({
    cookies: async () => ({ get: () => ({ value: "access-token" }) }),
    headers: async () => ({ get: () => null }),
}));
jest.mock("@semantask/auth", () => ({
    authConfig: { cookie: { accessToken: "access" } },
    verifyAccessToken: () => ({ sub: USER_ID, tokenVersion: 0, type: "access" }),
}));
jest.mock("@/lib/Db/db", () => ({ connectToDatabase: async () => undefined }));
jest.mock("@/models/User", () => ({ User: { findById: (id: string) => findById(id) } }));

// Each call may wait out the 500ms timeout. The margins are for slow CI, and sit
// far below the 4.3s per call of the SDK's default retries.
const ONE_CALL_BUDGET_MS = 1_500;
const REQUEST_BUDGET_MS = 2_500;
const TEST_TIMEOUT_MS = 15_000;

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

async function refusingHost(): Promise<CacheHost> {
    const server = await listen(() => undefined);
    const url = urlOf(server);
    await new Promise((resolve) => server.close(resolve));
    return { url, requests: () => null };
}

async function unresolvableHost(): Promise<CacheHost> {
    return { url: "https://semantask-cache-test.invalid", requests: () => null };
}

function loadWithCacheAt(url: string) {
    jest.resetModules();
    process.env.UPSTASH_REDIS_REST_URL = url;
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    return {
        cache: require("@/lib/utils/auth/userStateCache") as typeof import("@/lib/utils/auth/userStateCache"),
        requireAuthUser: (require("@/lib/utils/auth/requireAuthUser") as typeof import("@/lib/utils/auth/requireAuthUser"))
            .requireAuthUser,
    };
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
    ["refuses connections", refusingHost],
    ["does not resolve", unresolvableHost],
])("user state cache when the host %s", (_name, startHost) => {
    it("treats a read as a miss after one attempt", async () => {
        const host = await startHost();
        const { cache } = loadWithCacheAt(host.url);

        const { value, elapsedMs } = await timed(() => cache.getCachedUserState(USER_ID));

        expect(value).toBeNull();
        expect(elapsedMs).toBeLessThan(ONE_CALL_BUDGET_MS);
        expect(host.requests() ?? 1).toBe(1);
    }, TEST_TIMEOUT_MS);

    it("swallows writes and invalidations after one attempt each", async () => {
        const host = await startHost();
        const { cache } = loadWithCacheAt(host.url);

        const write = await timed(() => cache.setCachedUserState(STATE));
        const clear = await timed(() => cache.clearCachedUserState(USER_ID));

        expect(write.elapsedMs).toBeLessThan(ONE_CALL_BUDGET_MS);
        expect(clear.elapsedMs).toBeLessThan(ONE_CALL_BUDGET_MS);
        expect(host.requests() ?? 2).toBe(2);
    }, TEST_TIMEOUT_MS);

    it("authenticates a request from the database within budget", async () => {
        const host = await startHost();
        findById.mockReturnValue({
            select: () => ({
                lean: async () => ({ _id: { toString: () => USER_ID }, email: STATE.email, role: "user", tokenVersion: 0 }),
            }),
        });
        const { requireAuthUser } = loadWithCacheAt(host.url);

        const { value, elapsedMs } = await timed(() => requireAuthUser());

        expect(value.response).toBeNull();
        expect(value.user?.id).toBe(USER_ID);
        expect(findById).toHaveBeenCalledWith(USER_ID);
        expect(elapsedMs).toBeLessThan(REQUEST_BUDGET_MS);
    }, TEST_TIMEOUT_MS);
});

describe("user state cache when the host is healthy", () => {
    it("still stores state", async () => {
        const bodies: string[] = [];
        const server = await listen((req, res) => {
            let body = "";
            req.on("data", (chunk) => {
                body += chunk;
            });
            req.on("end", () => {
                bodies.push(body);
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify(req.url?.endsWith("/pipeline") ? [{ result: "OK" }] : { result: "OK" }));
            });
        });
        const { cache } = loadWithCacheAt(urlOf(server));

        await cache.setCachedUserState(STATE);

        expect(bodies.join("")).toContain(`auth:user-state:${USER_ID}`);
    }, TEST_TIMEOUT_MS);
});
