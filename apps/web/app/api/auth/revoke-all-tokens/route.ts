import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/Db/db";
import { validateAuthUser } from "@/lib/utils/auth/validateAuthUser";
import {
    invalidateAllUserTokens,
    authConfig,
    buildExpiredCookie,
    logAuthEventBestEffort,
} from "@semantask/auth";
import { clearCachedUserState } from "@/lib/utils/auth/userStateCache";
import { enforceAuthRateLimit, authRateLimitResponse } from "@/lib/utils/rateLimiter";

/**
 * POST /api/auth/revoke-all-tokens
 * 
 * Revokes all tokens for the authenticated user across all devices.
 * This is a security feature for users to:
 * - Logout from all devices immediately
 * - Force re-authentication if they suspect compromise
 * - Ensure no tokens are valid for their account
 * 
 * The endpoint requires authentication and will invalidate the current token
 * as well as all other tokens.
 * 
 * Response:
 * - 200: Success - all tokens revoked, session cookies cleared
 * - 401: Unauthorized - requires authentication
 * - 429: Rate limited
 * - 500: Server error
 */
export async function POST(req: NextRequest) {
    // Rate limiting: stricter than logout since this is a security action
    const xForwardedFor = req.headers.get("x-forwarded-for") || "";
    const ipAddress = xForwardedFor.split(",")[0]?.trim() || "unknown";
    const userAgent = req.headers.get("user-agent") || undefined;

    const rateLimit = await enforceAuthRateLimit({
        endpoint: "revoke_tokens",
        ipAddress,
        enableBackoff: false,
    });

    if (!rateLimit.allowed) {
        return authRateLimitResponse(rateLimit);
    }

    try {
        await connectToDatabase();

        // Validate user is authenticated
        const user = await validateAuthUser({ useRedisCache: false });

        // Invalidate all tokens for this user
        const result = await invalidateAllUserTokens(user.id, "user_logout_all_devices");

        // Clear cached user state
        await clearCachedUserState(user.id).catch(() => {
            // Ignore cache errors
        });

        // Log the token revocation
        await logAuthEventBestEffort({
            eventType: "tokens_revoked" as const,
            outcome: "success",
            userId: user.id,
            ipAddress,
            userAgent,
        });

        // Clear authentication cookies since tokens are now invalid
        const response = NextResponse.json(
            {
                success: true,
                message: "All tokens have been revoked. Please log in again.",
                tokenVersionBefore: result.previousTokenVersion,
                tokenVersionAfter: result.newTokenVersion,
                sessionsRevoked: result.sessionsRevoked,
            },
            { status: 200 }
        );

        // Clear auth cookies
        response.headers.set("Set-Cookie", buildExpiredCookie(authConfig.cookie.accessToken));
        response.headers.append("Set-Cookie", buildExpiredCookie(authConfig.cookie.refreshToken));

        return response;
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        const statusCode =
            message === "User not found"
                ? 404
                : message === "Access token is missing"
                  ? 401
                  : message === "User account has been deleted"
                    ? 403
                    : message === "User account is banned"
                      ? 403
                      : 500;

        await logAuthEventBestEffort({
            eventType: "tokens_revoked_failed" as const,
            outcome: "failure",
            ipAddress,
            userAgent,
            reason: message,
        });

        return NextResponse.json(
            {
                error: message || "Failed to revoke tokens",
            },
            { status: statusCode }
        );
    }
}
