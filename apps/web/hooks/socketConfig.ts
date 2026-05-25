const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const DEFAULT_LOCAL_SOCKET_URL = "http://localhost:3001";

function toLocalSocketUrl(protocol: string | undefined, hostname: string | undefined): string {
    const resolvedProtocol = protocol === "https:" ? "https:" : "http:";
    const resolvedHostname = hostname && hostname.trim() ? hostname : "localhost";
    return `${resolvedProtocol}//${resolvedHostname}:3001`;
}

/**
 * Browser socket URL resolution.
 * - Returns undefined for same-origin mode (best for nginx/docker proxy setups).
 * - Keeps explicit cross-origin URLs for split deployments (e.g. Vercel + Render).
 */
export function getClientSocketUrl(): string | undefined {
    const raw = process.env.NEXT_PUBLIC_SOCKET_URL?.trim();
    if (!raw) {
        if (typeof window === "undefined") {
            return DEFAULT_LOCAL_SOCKET_URL;
        }

        const current = window.location;
        const localSocketUrl = toLocalSocketUrl(current.protocol, current.hostname);
        const currentIsLocal = LOCAL_HOSTS.has(current.hostname);
        const currentIsProxyPort =
            current.port === "" || current.port === "80" || current.port === "443";

        if (currentIsLocal && !currentIsProxyPort) {
            return localSocketUrl;
        }

        if (!currentIsLocal && !currentIsProxyPort) {
            return localSocketUrl;
        }

        return undefined;
    }

    if (typeof window === "undefined") {
        return raw;
    }

    try {
        const configured = new URL(raw, window.location.origin);
        const current = window.location;

        if (configured.origin === current.origin) {
            return undefined;
        }

        const currentIsLocal = LOCAL_HOSTS.has(current.hostname);
        const currentIsProxyPort =
            current.port === "" || current.port === "80" || current.port === "443";
        const configuredIsLocalSocketPort =
            LOCAL_HOSTS.has(configured.hostname) && configured.port === "3001";

        // In local docker/nginx flows, browser must not dial container-internal socket port directly.
        if (currentIsLocal && currentIsProxyPort && configuredIsLocalSocketPort) {
            return undefined;
        }

        return configured.origin;
    } catch {
        return raw;
    }
}

/**
 * Server-side URL for internal HTTP calls to the socket service.
 */
export function getInternalSocketServerUrl(): string {
    return (
        process.env.SOCKET_SERVER_URL?.trim() ||
        process.env.NEXT_PUBLIC_SOCKET_URL?.trim() ||
        "http://localhost:3001"
    );
}
