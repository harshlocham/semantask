import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/utils/auth/requireAuthUser";

export async function GET() {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    return NextResponse.json({
        success: true,
        userId: guard.user.id,
    });
}
