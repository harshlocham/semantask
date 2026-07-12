import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
    createInternalRequestHeaders,
    getInternalSecretForTarget,
    hasValidInternalSecret,
    INTERNAL_SECRET_HEADER,
} from "@semantask/types/utils/internal-bridge-auth";

const secretKeys = [
    "INTERNAL_SECRET",
    "INTERNAL_SECRET_SOCKET",
    "INTERNAL_SECRET_WORKER",
    "INTERNAL_SECRET_SOCKET_PREVIOUS",
    "INTERNAL_SECRET_WORKER_PREVIOUS",
] as const;

const originalEnv = Object.fromEntries(
    secretKeys.map((key) => [key, process.env[key]])
);

beforeEach(() => {
    for (const key of secretKeys) {
        delete process.env[key];
    }
});

afterEach(() => {
    for (const key of secretKeys) {
        if (originalEnv[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = originalEnv[key];
        }
    }
});

test("createInternalRequestHeaders defaults to socket secret", () => {
    process.env.INTERNAL_SECRET_SOCKET = "socket-secret";
    process.env.INTERNAL_SECRET_WORKER = "worker-secret";
    const headers = createInternalRequestHeaders();
    assert.equal(headers.get(INTERNAL_SECRET_HEADER), "socket-secret");
});

test("createInternalRequestHeaders web target uses worker secret", () => {
    process.env.INTERNAL_SECRET_SOCKET = "socket-secret";
    process.env.INTERNAL_SECRET_WORKER = "worker-secret";
    const headers = createInternalRequestHeaders("web");
    assert.equal(headers.get(INTERNAL_SECRET_HEADER), "worker-secret");
});

test("socket audience rejects worker-only secret", () => {
    process.env.INTERNAL_SECRET_SOCKET = "socket-secret";
    process.env.INTERNAL_SECRET_WORKER = "worker-secret";
    assert.equal(hasValidInternalSecret("worker-secret", "socket"), false);
    assert.equal(hasValidInternalSecret("socket-secret", "socket"), true);
});

test("web audience rejects socket-only secret", () => {
    process.env.INTERNAL_SECRET_SOCKET = "socket-secret";
    process.env.INTERNAL_SECRET_WORKER = "worker-secret";
    assert.equal(hasValidInternalSecret("socket-secret", "web"), false);
    assert.equal(hasValidInternalSecret("worker-secret", "web"), true);
});

test("legacy INTERNAL_SECRET is accepted on both audiences", () => {
    process.env.INTERNAL_SECRET = "legacy-shared";
    assert.equal(hasValidInternalSecret("legacy-shared", "socket"), true);
    assert.equal(hasValidInternalSecret("legacy-shared", "web"), true);
});

test("previous secrets are accepted during rotation", () => {
    process.env.INTERNAL_SECRET_SOCKET = "new-socket";
    process.env.INTERNAL_SECRET_SOCKET_PREVIOUS = "old-socket";
    assert.equal(hasValidInternalSecret("old-socket", "socket"), true);
    assert.equal(hasValidInternalSecret("new-socket", "socket"), true);
});

test("getInternalSecretForTarget falls back to legacy", () => {
    process.env.INTERNAL_SECRET = "legacy-shared";
    assert.equal(getInternalSecretForTarget("socket"), "legacy-shared");
    assert.equal(getInternalSecretForTarget("web"), "legacy-shared");
});
