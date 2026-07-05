import { connectToDatabase } from "@/lib/Db/db";
import { sendOtpEmail } from "@/lib/utils/sendOtp";
import { NextRequest, NextResponse } from "next/server";
import { authRateLimiter } from "@/lib/utils/rateLimiter";
import { sendEmailOtpService } from "@semantask/auth";

export async function POST(req: NextRequest) {
    try {
        const ip = req.headers.get("x-forwarded-for") ?? "unknown";
        const { success } = await authRateLimiter.limit(ip);

        if (!success) {
            return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
        }
        await connectToDatabase();
        const { email } = await req.json();
        await sendEmailOtpService({
            email,
            sendOtpEmail,
        });

        return NextResponse.json({ success: true, message: "OTP sent successfully" });
    } catch (error) {
        console.error("Send OTP error:", error);
        if (error instanceof Error) {
            const status = error.message.includes("Please wait before requesting") ? 429 : 400;
            return NextResponse.json({ success: false, error: error.message }, { status });
        }

        return NextResponse.json({ success: false, error: "Failed to send OTP" }, { status: 500 });
    }
}