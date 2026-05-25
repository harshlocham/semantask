import type { TypedSocket } from "../types.js";
import jwt from "jsonwebtoken";
import { authorizeSocketIdentity } from "../services/socket-identity-authorization.js";

type AccessRole = "user" | "moderator" | "admin";

type AccessTokenPayload = {
    sub: string;
    role?: AccessRole;
    tokenVersion: number;
    type: "access";
};

function getHeaderValue(value: string | string[] | undefined): string | null {
    if (!value) return null;
    if (Array.isArray(value)) return value[0] ?? null;
    return value;
}

function getBearerToken(authorizationHeader: string | null): string | null {
    if (!authorizationHeader) return null;

    const [scheme, token] = authorizationHeader.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) {
        return null;
    }

    return token;
}

function getCookieToken(cookieHeader: string | null): string | null {
    if (!cookieHeader) return null;

    const cookieParts = cookieHeader.split(";");
    for (const part of cookieParts) {
        const [name, ...valueParts] = part.trim().split("=");
        if (name !== "accessToken") continue;
        const rawValue = valueParts.join("=");
        if (!rawValue) return null;
        return decodeURIComponent(rawValue);
    }

    return null;
}

function getHandshakeToken(socket: TypedSocket): string | null {
    const auth = (socket.handshake.auth ?? {}) as Record<string, unknown>;
    const fromAuth =
        (typeof auth.accessToken === "string" && auth.accessToken) ||
        (typeof auth.token === "string" && auth.token) ||
        null;
    if (fromAuth) return fromAuth;

    const fromHeader = getBearerToken(
        getHeaderValue(socket.handshake.headers.authorization)
    );
    if (fromHeader) return fromHeader;

    return getCookieToken(getHeaderValue(socket.handshake.headers.cookie));
}

function verifyAccessToken(token: string): AccessTokenPayload {
    const secret = process.env.ACCESS_TOKEN_SECRET;
    if (!secret) {
        throw new Error("ACCESS_TOKEN_SECRET is not configured");
    }

    // SECURITY FIX: Restrict algorithm to HS256 to prevent algorithm substitution attacks
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] }) as Partial<AccessTokenPayload>;

    if (
        !payload ||
        payload.type !== "access" ||
        typeof payload.sub !== "string" ||
        typeof payload.tokenVersion !== "number" ||
        !Number.isInteger(payload.tokenVersion) ||
        payload.tokenVersion < 0
    ) {
        throw new Error("Invalid access token payload");
    }

    return {
        sub: payload.sub,
        role: payload.role,
        tokenVersion: payload.tokenVersion,
        type: "access",
    };
}

export async function socketAuth(
    socket: TypedSocket,
    next: (err?: Error) => void
): Promise<void> {
    try {
        const token = getHandshakeToken(socket);
        if (!token) {
            return next(new Error("Unauthorized"));
        }

        const payload = verifyAccessToken(token);

        // Never trust JWT claims alone; the web internal auth endpoint
        // revalidates user existence/ban/deletion state against MongoDB.
        const authz = await authorizeSocketIdentity({
            userId: payload.sub,
            tokenVersion: payload.tokenVersion,
        });

        if (!authz.allowed) {
            return next(new Error("Unauthorized"));
        }

        socket.data.userId = payload.sub;
        socket.data.isAdmin = authz.role === "admin";
        return next();
    } catch {
        return next(new Error("Unauthorized"));
    }
}