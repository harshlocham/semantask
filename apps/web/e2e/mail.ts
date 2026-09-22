import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { E2E_MAIL_DIR } from "./env";

type MailPayload = {
    to?: string;
    text?: string;
};

function otpFromText(text: string): string | null {
    const match = text.match(/Your OTP is (\d{6})/);
    return match?.[1] ?? null;
}

export async function waitForOtp(email: string, timeoutMs = 15_000): Promise<string> {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
        let files: string[] = [];
        try {
            files = (await readdir(E2E_MAIL_DIR)).filter((name) => name.endsWith(".json"));
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 200));
            continue;
        }

        const matches: { file: string; otp: string }[] = [];
        for (const file of files) {
            const raw = JSON.parse(await readFile(join(E2E_MAIL_DIR, file), "utf8")) as MailPayload;
            if (raw.to !== email) {
                continue;
            }
            const otp = otpFromText(String(raw.text ?? ""));
            if (otp) {
                matches.push({ file, otp });
            }
        }

        if (matches.length > 0) {
            matches.sort((a, b) => a.file.localeCompare(b.file));
            return matches[matches.length - 1].otp;
        }

        await new Promise((resolve) => setTimeout(resolve, 200));
    }

    throw new Error(`OTP for ${email} was not written to ${E2E_MAIL_DIR}`);
}
