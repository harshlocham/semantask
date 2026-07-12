import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/Db/db";
import { requireAdminUser } from "@/lib/utils/auth/requireAdminUser";
import {
    grantTool,
    listToolGrants,
    seedExistingUsersToolGrants,
    isHighRiskToolName,
    type HighRiskToolName,
} from "@semantask/services/tool-grant.service";
import { AuthorizationError } from "@semantask/services/authorization.service";

function parsePositiveInt(value: string | null, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(req: Request) {
    const guard = await requireAdminUser();
    if (guard.response) {
        return guard.response;
    }

    const url = new URL(req.url);
    const page = parsePositiveInt(url.searchParams.get("page"), 1);
    const limit = parsePositiveInt(url.searchParams.get("limit"), 20);
    const userId = url.searchParams.get("userId") || undefined;
    const toolName = url.searchParams.get("toolName") || undefined;
    const includeRevoked = url.searchParams.get("includeRevoked") === "1";

    try {
        await connectToDatabase();
        const result = await listToolGrants({ page, limit, userId, toolName, includeRevoked });
        return NextResponse.json({ success: true, data: result });
    } catch (error) {
        console.error("Failed to list tool grants", error);
        return NextResponse.json({ success: false, error: "Failed to list tool grants" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const guard = await requireAdminUser();
    if (guard.response) {
        return guard.response;
    }

    try {
        await connectToDatabase();
        const body = await req.json() as {
            action?: string;
            userId?: string;
            toolName?: string;
            conversationId?: string | null;
        };

        if (body.action === "seed") {
            const result = await seedExistingUsersToolGrants(guard.user.id);
            return NextResponse.json({ success: true, data: result });
        }

        if (!body.userId || !body.toolName || !isHighRiskToolName(body.toolName)) {
            return NextResponse.json(
                { success: false, error: "userId and a high-risk toolName are required" },
                { status: 400 }
            );
        }

        const grant = await grantTool({
            userId: body.userId,
            toolName: body.toolName as HighRiskToolName,
            grantedBy: guard.user.id,
            conversationId: body.conversationId ?? null,
        });

        return NextResponse.json({
            success: true,
            data: {
                id: grant._id.toString(),
                userId: grant.userId.toString(),
                conversationId: grant.conversationId ? grant.conversationId.toString() : null,
                toolName: grant.toolName,
                grantedBy: grant.grantedBy.toString(),
                revokedAt: grant.revokedAt ? grant.revokedAt.toISOString() : null,
                createdAt: grant.createdAt.toISOString(),
            },
        });
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: error.code === "NOT_FOUND" ? 404 : 403 }
            );
        }
        console.error("Failed to create tool grant", error);
        return NextResponse.json({ success: false, error: "Failed to create tool grant" }, { status: 500 });
    }
}
