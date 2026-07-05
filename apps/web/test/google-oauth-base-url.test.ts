import { NextRequest } from "next/server";
import {
    buildAppRedirectUrl,
    getGoogleOAuthBaseUrl,
} from "@/lib/utils/auth/googleOAuthBaseUrl";

function makeRequest(url: string, headers?: Record<string, string>): NextRequest {
    return new NextRequest(url, headers ? { headers } : undefined);
}

describe("getGoogleOAuthBaseUrl", () => {
    const originalAppUrl = process.env.APP_URL;

    afterEach(() => {
        if (originalAppUrl === undefined) {
            delete process.env.APP_URL;
        } else {
            process.env.APP_URL = originalAppUrl;
        }
    });

    it("prefers forwarded host and proto from the reverse proxy", () => {
        const req = makeRequest("http://nextapp:3000/api/auth/google/start", {
            host: "semantask.com",
            "x-forwarded-proto": "https",
        });

        expect(getGoogleOAuthBaseUrl(req)).toBe("https://semantask.com");
    });

    it("falls back to APP_URL when host headers are missing", () => {
        process.env.APP_URL = "https://semantask.com";
        const req = makeRequest("http://127.0.0.1:3000/api/auth/google/start");

        expect(getGoogleOAuthBaseUrl(req)).toBe("https://semantask.com");
    });

    it("uses request origin for local development", () => {
        delete process.env.APP_URL;
        const req = makeRequest("http://localhost:3000/api/auth/google/start", {
            host: "localhost:3000",
        });

        expect(getGoogleOAuthBaseUrl(req)).toBe("http://localhost:3000");
    });
});

describe("buildAppRedirectUrl", () => {
    it("builds login redirect on public origin behind proxy", () => {
        const req = makeRequest("http://localhost:3000/api/auth/google/callback", {
            host: "semantask.com",
            "x-forwarded-proto": "https",
        });

        const url = buildAppRedirectUrl(req, "/login");
        url.searchParams.set("error", "google_token_exchange_failed");

        expect(url.toString()).toBe(
            "https://semantask.com/login?error=google_token_exchange_failed"
        );
    });
});
