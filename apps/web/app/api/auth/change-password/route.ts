import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/Db/db";
import { validateAuthUser } from "@/lib/utils/auth/validateAuthUser";
import {
    changePasswordService,
    authConfig,
    buildExpiredCookie,
    logAuthEventBestEffort,
} from "@semantask/auth";
import { clearCachedUserState } from "@/lib/utils/auth/userStateCache";
import { enforceAuthRateLimit, authRateLimitResponse } from "@/lib/utils/rateLimiter";

export async function POST(req: NextRequest) {
    // Rate limiting: more lenient than login, once per minute
    const xForwardedFor = req.headers.get("x-forwarded-for") || "";
    const ipAddress = xForwardedFor.split(",")[0]?.trim() || "unknown";
    const userAgent = req.headers.get("user-agent") || undefined;

    const rateLimit = await enforceAuthRateLimit({
        endpoint: "change_password",
        ipAddress,
        enableBackoff: false,
    });

    if (!rateLimit.allowed) {
        await logAuthEventBestEffort({
            eventType: "password_change_failed",
            outcome: "failure",
            ipAddress,
            userAgent,
            reason: "rate_limited",
        });
        return authRateLimitResponse(rateLimit);
    }

    try {
        await connectToDatabase();

        // Validate user is authenticated
        const user = await validateAuthUser({ useRedisCache: false });

        // Parse request body
        const body = await req.json();
        const { oldPassword, newPassword } = body;

        if (!oldPassword || typeof oldPassword !== "string") {
            await logAuthEventBestEffort({
                eventType: "password_change_failed",
                outcome: "failure",
                userId: user.id,
                ipAddress,
                userAgent,
                reason: "invalid_old_password",
            });
            return NextResponse.json(
                { error: "Current password is required" },
                { status: 400 }
            );
        }

        if (!newPassword || typeof newPassword !== "string") {
            await logAuthEventBestEffort({
                eventType: "password_change_failed" as const,
                outcome: "failure",
                userId: user.id,
                ipAddress,
                userAgent,
                reason: "invalid_new_password",
            });
            return NextResponse.json(
                { error: "New password is required" },
                { status: 400 }
            );
        }

        // Validate password strength
        if (newPassword.length < 8) {
            await logAuthEventBestEffort({
                eventType: "password_change_failed" as const,
                outcome: "failure",
                userId: user.id,
                ipAddress,
                userAgent,
                reason: "weak_password",
            });
            return NextResponse.json(
                { error: "Password must be at least 8 characters long" },
                { status: 400 }
            );
        }

        if (oldPassword === newPassword) {
            await logAuthEventBestEffort({
                eventType: "password_change_failed" as const,
                outcome: "failure",
                userId: user.id,
                ipAddress,
                userAgent,
                reason: "same_password",
            });
            return NextResponse.json(
                { error: "New password must be different from current password" },
                { status: 400 }
            );
        }

        // Change password (this invalidates all tokens)
        const result = await changePasswordService({
            userId: user.id,
            oldPassword,
            newPassword,
        });

        // Clear cached user state
        await clearCachedUserState(user.id).catch(() => {
            // Ignore cache errors
        });

        // Log successful password change
        await logAuthEventBestEffort({
            eventType: "password_changed" as const,
            outcome: "success",
            userId: user.id,
            ipAddress,
            userAgent,
        });

        // Clear authentication cookies since token is invalidated
        const response = NextResponse.json(
            {
                success: true,
                message: "Password changed successfully. Please log in again.",
                tokenVersionBefore: result.tokenVersionBefore,
                tokenVersionAfter: result.tokenVersionAfter,
            },
            { status: 200 }
        );

        // Clear auth cookies
        response.headers.set("Set-Cookie", buildExpiredCookie(authConfig.cookie.accessToken));
        response.headers.append("Set-Cookie", buildExpiredCookie(authConfig.cookie.refreshToken));

        return response;
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        const status =
            message === "User not found"
                ? 404
                : message === "Current password is incorrect"
                  ? 401
                  : message === "User does not have password authentication enabled"
                    ? 403
                    : 500;

        await logAuthEventBestEffort({
            eventType: "password_change_failed" as const,
            outcome: "failure",
            ipAddress,
            userAgent,
            reason: message,
        });

        return NextResponse.json({ error: message || "Failed to change password" }, { status });
    }
}
