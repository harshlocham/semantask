import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/Db/db";
import { requireAuthUser } from "@/lib/utils/auth/requireAuthUser";
import { completeOnboardingConversation } from "@/lib/onboarding/complete-onboarding";

export async function POST() {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    try {
        await connectToDatabase();
        const result = await completeOnboardingConversation(guard.user.id);
        return NextResponse.json(result, { status: 200 });
    } catch (error) {
        console.error("POST /api/onboarding/complete error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to complete onboarding" },
            { status: 500 }
        );
    }
}
