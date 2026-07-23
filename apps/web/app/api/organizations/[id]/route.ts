import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/Db/db";
import { requireAuthUser } from "@/lib/utils/auth/requireAuthUser";
import {
    assertMembership,
    getOrganizationById,
    serializeOrganization,
    updateOrganization,
} from "@semantask/services/organization.service";
import { AuthorizationError } from "@semantask/services/authorization.service";
import type { OrganizationStatus } from "@semantask/db/models/Organization";
import { organizationApiErrorStatus } from "@semantask/services/organization-errors";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    const { id } = await context.params;

    try {
        await connectToDatabase();
        const membership = await assertMembership(id, guard.user.id);
        const org = await getOrganizationById(id);
        if (!org) {
            return NextResponse.json(
                { success: false, error: "Organization not found" },
                { status: 404 }
            );
        }

        return NextResponse.json({
            success: true,
            data: {
                ...serializeOrganization(org),
                role: membership.role,
            },
        });
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: error.code === "NOT_FOUND" ? 404 : 403 }
            );
        }
        console.error("GET /api/organizations/[id] error", error);
        return NextResponse.json(
            { success: false, error: "Failed to load organization" },
            { status: organizationApiErrorStatus(error) }
        );
    }
}

export async function PATCH(req: Request, context: RouteContext) {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    const { id } = await context.params;

    try {
        await connectToDatabase();
        const body = (await req.json()) as { name?: string; status?: OrganizationStatus };

        const updated = await updateOrganization({
            organizationId: id,
            actorUserId: guard.user.id,
            name: body.name,
            status: body.status,
        });

        return NextResponse.json({
            success: true,
            data: serializeOrganization(updated),
        });
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: error.code === "NOT_FOUND" ? 404 : 403 }
            );
        }
        const message = error instanceof Error ? error.message : "Failed to update organization";
        console.error("PATCH /api/organizations/[id] error", error);
        return NextResponse.json(
            { success: false, error: message },
            { status: organizationApiErrorStatus(error) }
        );
    }
}
