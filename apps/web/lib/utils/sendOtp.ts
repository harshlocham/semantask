import { sendTransactionalEmail } from "@/lib/utils/send-email";

export async function sendOtpEmail(email: string, otp: string): Promise<void> {
    await sendTransactionalEmail({
        to: email,
        subject: "Your verification code",
        text: `Your OTP is ${otp}. It expires in 5 minutes.`,
        html: `<p>Your OTP is <b>${otp}</b>. It expires in 5 minutes.</p>`,
    });
}
