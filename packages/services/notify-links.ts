/** Absolute deep-link helpers for product notification emails. */

function firstNonEmpty(...values: Array<string | null | undefined>): string | undefined {
    for (const value of values) {
        const trimmed = value?.trim();
        if (trimmed) return trimmed;
    }
    return undefined;
}

/** Origin for absolute CTAs. Prefer PUBLIC_APP_URL, then APP_URL. */
export function appOrigin(): string | null {
    const raw = firstNonEmpty(process.env.PUBLIC_APP_URL, process.env.APP_URL);
    if (!raw) return null;
    return raw.replace(/\/$/, "");
}

export function taskPath(taskId: string): string {
    return `/work/${encodeURIComponent(taskId)}`;
}

export function approvalsPath(): string {
    return "/inbox/approvals";
}

export function absoluteTaskHref(taskId: string): string | null {
    const origin = appOrigin();
    if (!origin) return null;
    return `${origin}${taskPath(taskId)}`;
}

export function absoluteApprovalsHref(): string | null {
    const origin = appOrigin();
    if (!origin) return null;
    return `${origin}${approvalsPath()}`;
}

export function withAbsoluteCta(bodyHtml: string, href: string | null, label: string): string {
    if (!href) return bodyHtml;
    return `${bodyHtml}<p><a href="${href}">${label}</a></p>`;
}

export function withAbsoluteCtaText(bodyText: string, href: string | null, label: string): string {
    if (!href) return bodyText;
    return `${bodyText}\n\n${label}: ${href}`;
}
