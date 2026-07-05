import { NextResponse } from "next/server";
import { AuthError, isAuthError } from "@/lib/utils/auth/authErrors";
import { validateAuthUserById } from "@/lib/utils/auth/validateAuthUser";
import {
    getInternalSecret,
    hasValidInternalSecret,
    INTERNAL_SECRET_HEADER,
} from "@semantask/types/utils/internal-bridge-auth";

type AuthorizeIdentityBody = {
    userId?: string;
    tokenVersion?: number;
};

function deny(reason: string, status = 403) {
    return NextResponse.json({ allowed: false, reason }, { status });
}

export async function POST(req: Request) {
    const providedSecret = req.headers.get(INTERNAL_SECRET_HEADER);
    if (!hasValidInternalSecret(providedSecret, getInternalSecret())) {
        return deny("unauthorized_internal_request", 401);
    }

    let body: AuthorizeIdentityBody;
    try {
        body = (await req.json()) as AuthorizeIdentityBody;
    } catch {
        return deny("invalid_json", 400);
    }

    const { userId, tokenVersion } = body;
    if (!userId) {
        return deny("invalid_payload", 400);
    }

    if (
        tokenVersion !== undefined &&
        (typeof tokenVersion !== "number" || !Number.isInteger(tokenVersion) || tokenVersion < 0)
    ) {
        return deny("invalid_token_version", 400);
    }

    try {
        const user = await validateAuthUserById({
            userId,
            tokenVersion,
            options: { useRedisCache: true, cacheTtlSeconds: 45 },
        });

        return NextResponse.json({
            allowed: true,
            role: user.role,
        });
    } catch (error) {
        if (isAuthError(error)) {
            return deny(mapAuthErrorToReason(error), error.statusCode);
        }

        return deny("authorization_service_error", 500);
    }
}

function mapAuthErrorToReason(error: AuthError): string {
    switch (error.code) {
        case "AUTH_USER_NOT_FOUND":
            return "user_not_found";
        case "AUTH_USER_BANNED":
            return "user_banned";
        case "AUTH_USER_DELETED":
            return "user_deleted";
        case "AUTH_TOKEN_REVOKED":
            return "token_version_revoked";
        default:
            return "unauthorized";
    }
}
