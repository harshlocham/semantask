import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/Db/db";
import { requireAdminUser } from "@/lib/utils/auth/requireAdminUser";
import { revokeTool } from "@semantask/services/tool-grant.service";
import { AuthorizationError } from "@semantask/services/authorization.service";

type RouteContext = {
    params: Promise<{ id: string }> | { id: string };
};

export async function DELETE(_req: Request, context: RouteContext) {
    const guard = await requireAdminUser();
    if (guard.response) {
        return guard.response;
    }

    try {
        await connectToDatabase();
        const params = await Promise.resolve(context.params);
        const grant = await revokeTool(params.id);

        return NextResponse.json({
            success: true,
            data: grant
                ? {
                    id: grant._id.toString(),
                    revokedAt: grant.revokedAt ? grant.revokedAt.toISOString() : null,
                }
                : null,
        });
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: error.code === "NOT_FOUND" ? 404 : 403 }
            );
        }
        console.error("Failed to revoke tool grant", error);
        return NextResponse.json({ success: false, error: "Failed to revoke tool grant" }, { status: 500 });
    }
}
