import { getResendConfig, isResendConfigured } from "@/lib/config/resend";

export { isResendConfigured };

export async function sendTransactionalEmail(input: {
    to: string;
    subject: string;
    text: string;
    html: string;
}): Promise<void> {
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
