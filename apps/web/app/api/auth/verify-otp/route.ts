import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/Db/db";
import { verifyOtpAndRegisterService } from "@semantask/auth";

export async function POST(req: Request) {
    try {
        await connectToDatabase();
        const { email, otp, name, password } = await req.json();

        if (!email || !otp || !name || !password) {
            return NextResponse.json({ success: false, error: "Email, OTP, name and password are required" }, { status: 400 });
        }

        await verifyOtpAndRegisterService({
            email,
            otp,
            username: name,
            password,
        });

        return NextResponse.json({ success: true, message: "OTP verified successfully" });
    } catch (error) {
        console.log("Verify OTP error:", error);
        if (error instanceof Error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        }
        return NextResponse.json({ success: false, error: "Failed to verify OTP" }, { status: 500 });
    }
}