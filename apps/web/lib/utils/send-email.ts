import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getResendConfig, isResendConfigured } from "@/lib/config/resend";

export { isResendConfigured };

function e2eMailDir(): string | null {
    const dir = process.env.E2E_MAIL_DIR?.trim();
    return dir || null;
}

async function writeE2eMail(input: {
    to: string;
    subject: string;
    text: string;
    html: string;
}): Promise<void> {
    const dir = e2eMailDir();
    if (!dir) {
        return;
    }

    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeTo = input.to.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const filePath = join(dir, `${stamp}-${safeTo}-${randomUUID()}.json`);
    await writeFile(
        filePath,
        JSON.stringify({
            to: input.to,
            subject: input.subject,
            text: input.text,
            html: input.html,
        }),
        "utf8"
    );
}

export async function sendTransactionalEmail(input: {
    to: string;
    subject: string;
    text: string;
    html: string;
}): Promise<void> {
    if (e2eMailDir()) {
        await writeE2eMail(input);
        return;
    }

    const { apiKey, from } = getResendConfig();
    if (!apiKey || !from) {
        throw new Error("Resend is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.");
    }

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            from,
            to: [input.to],
            subject: input.subject,
            text: input.text,
            html: input.html,
        }),
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(detail.trim() || `Failed to send email (${response.status})`);
    }
}
