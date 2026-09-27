import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/Db/db";
import { requireAuthUser } from "@/lib/utils/auth/requireAuthUser";
import { resolveOrganizationContext } from "@/lib/utils/auth/resolveOrganizationContext";
import { completeOnboardingConversation } from "@/lib/onboarding/complete-onboarding";

export async function POST(req: Request) {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    const orgContext = await resolveOrganizationContext(req, guard.user);
    if (orgContext.response) {
        return orgContext.response;
    }

    try {
        await connectToDatabase();
        const result = await completeOnboardingConversation(guard.user.id, orgContext.organizationId);
        return NextResponse.json(result, { status: 200 });
    } catch (error) {
        console.error("POST /api/onboarding/complete error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to complete onboarding" },
            { status: 500 }
        );
    }
}
