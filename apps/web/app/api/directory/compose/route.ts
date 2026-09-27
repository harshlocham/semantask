import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/utils/auth/requireAuthUser";
import { resolveOrganizationContext } from "@/lib/utils/auth/resolveOrganizationContext";
import { AuthorizationError } from "@semantask/services/authorization.service";
import { composeDirectory } from "@semantask/services/compose-directory.service";
import {
    organizationApiErrorStatus,
    ValidationError,
} from "@semantask/services/organization-errors";

export async function GET(req: Request) {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    const orgContext = await resolveOrganizationContext(req, guard.user);
    if (orgContext.response) {
        return orgContext.response;
    }

    const url = new URL(req.url);
    const query = url.searchParams.get("q") ?? "";
    const cursor = url.searchParams.get("cursor");
    const limitParam = url.searchParams.get("limit");
    let limit: number | undefined;
    if (limitParam != null && limitParam !== "") {
        limit = Number(limitParam);
        if (!Number.isFinite(limit)) {
            return NextResponse.json(
                { success: false, error: "Invalid limit" },
                { status: 400 }
            );
        }
    }

    try {
        const directory = await composeDirectory({
            actorUserId: guard.user.id,
            organizationId: orgContext.organizationId,
            query,
            cursor,
            limit,
        });
        return NextResponse.json({ success: true, ...directory });
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: error.code === "NOT_FOUND" ? 404 : 403 }
            );
        }
        if (error instanceof ValidationError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: 400 }
            );
        }
        console.error("GET /api/directory/compose error", error);
        return NextResponse.json(
            { success: false, error: "Failed to load people" },
            { status: organizationApiErrorStatus(error) }
        );
    }
}
