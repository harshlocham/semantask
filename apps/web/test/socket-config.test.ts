import { afterEach, describe, expect, it, jest } from "@jest/globals";

describe("getClientSocketUrl", () => {
    const originalSocketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;

    afterEach(() => {
        process.env.NEXT_PUBLIC_SOCKET_URL = originalSocketUrl;
        jest.resetModules();
        delete (global as any).window;
    });

    it("defaults to localhost:3001 on local dev when no public socket url is configured", () => {
        delete process.env.NEXT_PUBLIC_SOCKET_URL;
        (global as any).window = {
            location: {
                hostname: "localhost",
                port: "3002",
                origin: "http://localhost:3002",
            },
        };

        const { getClientSocketUrl } = require("../hooks/socketConfig") as {
            getClientSocketUrl: () => string | undefined;
        };

        expect(getClientSocketUrl()).toBe("http://localhost:3001");
    });

    it("uses same-origin mode behind a local proxy when no public socket url is configured", () => {
        delete process.env.NEXT_PUBLIC_SOCKET_URL;
        (global as any).window = {
            location: {
                hostname: "localhost",
                port: "80",
                origin: "http://localhost",
            },
        };

        const { getClientSocketUrl } = require("../hooks/socketConfig") as {
            getClientSocketUrl: () => string | undefined;
        };

        expect(getClientSocketUrl()).toBeUndefined();
    });

    it("uses current host for local fallback to keep socket auth cookies on same host", () => {
        delete process.env.NEXT_PUBLIC_SOCKET_URL;
        (global as any).window = {
            location: {
                protocol: "http:",
                hostname: "127.0.0.1",
                port: "3002",
                origin: "http://127.0.0.1:3002",
            },
        };

        const { getClientSocketUrl } = require("../hooks/socketConfig") as {
            getClientSocketUrl: () => string | undefined;
        };

        expect(getClientSocketUrl()).toBe("http://127.0.0.1:3001");
    });
});
