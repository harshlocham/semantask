import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sendOtpEmail } from "@/lib/utils/sendOtp";

function withEnv(values: Record<string, string | undefined>, fn: () => Promise<void>) {
    const previous: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(values)) {
        previous[key] = process.env[key];
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
    return fn().finally(() => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });
}

describe("sendOtpEmail (Resend)", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        globalThis.fetch = jest.fn() as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("posts the OTP to Resend when configured", async () => {
        await withEnv({
            RESEND_API_KEY: "re_test",
            RESEND_FROM_EMAIL: "Semantask <noreply@semantask.test>",
            EMAIL_FROM: undefined,
        }, async () => {
            (globalThis.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                text: async () => "",
            });

            await sendOtpEmail("sohansinghharsh@gmail.com", "104022");

            expect(globalThis.fetch).toHaveBeenCalledWith(
                "https://api.resend.com/emails",
                expect.objectContaining({
                    method: "POST",
                    headers: expect.objectContaining({
                        Authorization: "Bearer re_test",
                        "Content-Type": "application/json",
                    }),
                })
            );

            const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
            expect(JSON.parse(String(init.body))).toEqual({
                from: "Semantask <noreply@semantask.test>",
                to: ["sohansinghharsh@gmail.com"],
                subject: "Your verification code",
                text: "Your OTP is 104022. It expires in 5 minutes.",
                html: "<p>Your OTP is <b>104022</b>. It expires in 5 minutes.</p>",
            });
        });
    });

    it("writes JSON to E2E_MAIL_DIR instead of calling Resend", async () => {
        const dir = await mkdtemp(join(tmpdir(), "semantask-e2e-mail-"));
        await withEnv({
            E2E_MAIL_DIR: dir,
            RESEND_API_KEY: undefined,
            RESEND_FROM_EMAIL: undefined,
        }, async () => {
            await sendOtpEmail("alice@e2e.semantask.test", "654321");

            expect(globalThis.fetch).not.toHaveBeenCalled();
            const files = await readdir(dir);
            expect(files).toHaveLength(1);
            const payload = JSON.parse(await readFile(join(dir, files[0]), "utf8")) as {
                to: string;
                subject: string;
                text: string;
            };
            expect(payload.to).toBe("alice@e2e.semantask.test");
            expect(payload.subject).toBe("Your verification code");
            expect(payload.text).toContain("654321");
        });
    });

    it("throws when Resend is not configured", async () => {
        await withEnv({
            RESEND_API_KEY: undefined,
            RESEND_FROM_EMAIL: undefined,
            EMAIL_FROM: undefined,
            E2E_MAIL_DIR: undefined,
        }, async () => {
            await expect(sendOtpEmail("user@example.com", "123456")).rejects.toThrow(
                "Resend is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL."
            );
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });
    });

    it("throws when Resend returns a non-OK response", async () => {
        await withEnv({
            RESEND_API_KEY: "re_test",
            RESEND_FROM_EMAIL: "noreply@semantask.test",
        }, async () => {
            (globalThis.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                status: 401,
                text: async () => "invalid api key",
            });

            await expect(sendOtpEmail("user@example.com", "123456")).rejects.toThrow("invalid api key");
        });
    });
});
