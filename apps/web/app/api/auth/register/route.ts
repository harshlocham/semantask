import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/Db/db";
import { authRateLimitResponse, enforceAuthRateLimit } from "@/lib/utils/rateLimiter";
import {
    buildAccessTokenCookie,
    buildRefreshTokenCookie,
    createUserSession,
    generateAccessToken,
    logAuthEventBestEffort,
    registerService,
} from "@semantask/auth";

function safeIpAddress(req: NextRequest): string {
    const xForwardedFor = req.headers.get("x-forwarded-for") || "";
    return xForwardedFor.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: NextRequest) {
    const ipAddress = safeIpAddress(req);
    const userAgent = req.headers.get("user-agent") || undefined;
    const headerDeviceId = req.headers.get("x-device-id") || undefined;

    try {
        const body = await req.json();
        const username = String(body?.username || body?.name || "").trim();
        const email = String(body?.email || "").trim();
        const password = String(body?.password || "");
        const bodyDeviceId = String(body?.deviceId || "").trim() || undefined;
        const deviceId = bodyDeviceId || headerDeviceId;

        const rateLimit = await enforceAuthRateLimit({
            endpoint: "register",
            ipAddress,
            identifier: email,
            enableBackoff: true,
        });
        if (!rateLimit.allowed) {
            await logAuthEventBestEffort({
                eventType: "register_failed",
                outcome: "failure",
                email,
                ipAddress,
                userAgent,
                reason: "rate_limited",
            });
            return authRateLimitResponse(rateLimit);
        }

        if (!username || !email || !password) {
            await logAuthEventBestEffort({
                eventType: "register_failed",
                outcome: "failure",
                email,
                ipAddress,
                userAgent,
                reason: "missing_fields",
            });
            return NextResponse.json(
                { success: false, error: "Username, email and password are required" },
                { status: 400 }
            );
        }

        await connectToDatabase();

        const user = await registerService({
            username,
            email,
            password,
        });

        const accessToken = generateAccessToken({
            sub: user._id.toString(),
            role: user.role,
            tokenVersion: user.tokenVersion || 0,
            type: "access",
        });

        const { refreshToken } = await createUserSession({
            userId: user._id.toString(),
            deviceId,
            userAgent,
            ipAddress,
            tokenVersion: user.tokenVersion || 0,
        });

        await logAuthEventBestEffort({
            eventType: "register_success",
            outcome: "success",
            userId: user._id.toString(),
            email: user.email,
            ipAddress,
            userAgent,
        });

        const response = NextResponse.json({
            success: true,
            user: {
                id: user._id.toString(),
                username: user.username,
                email: user.email,
                role: user.role,
                status: user.status,
                profilePicture: user.profilePicture || null,
            },
        });

        response.headers.append("Set-Cookie", buildAccessTokenCookie(accessToken));
        response.headers.append("Set-Cookie", buildRefreshTokenCookie(refreshToken));

        return response;
    } catch (error) {
        if (error instanceof Error) {
            await logAuthEventBestEffort({
                eventType: "register_failed",
                outcome: "failure",
                ipAddress,
                userAgent,
                reason: error.message,
            });
            const status = error.message === "User already exists" ? 409 : 400;
            return NextResponse.json({ success: false, error: error.message }, { status });
        }

        await logAuthEventBestEffort({
            eventType: "register_failed",
            outcome: "failure",
            ipAddress,
            userAgent,
            reason: "unknown_error",
        });
        return NextResponse.json({ success: false, error: "Registration failed" }, { status: 500 });
    }
}
