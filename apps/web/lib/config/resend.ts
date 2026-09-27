import { firstNonEmpty } from "./parse";

export type ResendConfig = {
    apiKey: string | undefined;
    from: string | undefined;
};

export function getResendConfig(): ResendConfig {
    return {
        apiKey: firstNonEmpty(process.env.RESEND_API_KEY),
        from: firstNonEmpty(process.env.RESEND_FROM_EMAIL, process.env.EMAIL_FROM),
    };
}

export function isResendConfigured(): boolean {
    const { apiKey, from } = getResendConfig();
    return Boolean(apiKey && from);
}
