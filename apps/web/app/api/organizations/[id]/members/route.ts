import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/Db/db";
import { requireAuthUser } from "@/lib/utils/auth/requireAuthUser";
import {
    addOrganizationMember,
    assertCanManageMembers,
    listOrganizationMembers,
    removeOrganizationMember,
} from "@semantask/services/organization.service";
import { AuthorizationError } from "@semantask/services/authorization.service";
import type { OrganizationMemberRole } from "@semantask/db/models/OrganizationMembership";
import {
    assertMemberQuotaAvailable,
    OrgQuotaExceededError,
} from "@semantask/services/organization-quota.service";
import {
    organizationApiErrorStatus,
    ValidationError,
} from "@semantask/services/organization-errors";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    const { id } = await context.params;

    try {
        await connectToDatabase();
        const members = await listOrganizationMembers(id, guard.user.id);
        return NextResponse.json({ success: true, data: members });
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: error.code === "NOT_FOUND" ? 404 : 403 }
            );
        }
        console.error("GET /api/organizations/[id]/members error", error);
        return NextResponse.json(
            { success: false, error: "Failed to list members" },
            { status: organizationApiErrorStatus(error) }
        );
    }
}

export async function POST(req: Request, context: RouteContext) {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    const { id } = await context.params;

    try {
        await connectToDatabase();
        const body = (await req.json()) as {
            userId?: string;
            role?: OrganizationMemberRole;
        };

        if (!body.userId) {
            return NextResponse.json(
                { success: false, error: "userId is required" },
                { status: 400 }
            );
        }

        await assertCanManageMembers(id, guard.user.id);

        try {
            await assertMemberQuotaAvailable(id);
        } catch (quotaError) {
            if (quotaError instanceof OrgQuotaExceededError) {
                return NextResponse.json(
                    {
                        success: false,
                        error: quotaError.message,
                        code: "ORG_QUOTA_EXCEEDED",
                    },
                    { status: 429 }
                );
            }
            throw quotaError;
        }

        const membership = await addOrganizationMember({
            organizationId: id,
            actorUserId: guard.user.id,
            userId: body.userId,
            role: body.role,
        });

        return NextResponse.json(
            {
                success: true,
                data: {
                    id: membership._id.toString(),
                    userId: membership.userId.toString(),
                    role: membership.role,
                    createdAt: membership.createdAt.toISOString(),
                },
            },
            { status: 201 }
        );
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: error.code === "NOT_FOUND" ? 404 : 403 }
            );
        }
        const message = error instanceof Error ? error.message : "Failed to add member";
        console.error("POST /api/organizations/[id]/members error", error);
        const status = error instanceof ValidationError
            || message.includes("Cannot")
            || message.includes("Invalid")
            ? 400
            : organizationApiErrorStatus(error);
        return NextResponse.json(
            { success: false, error: message },
            { status }
        );
    }
}

export async function DELETE(req: Request, context: RouteContext) {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    const { id } = await context.params;

    try {
        await connectToDatabase();
        const body = (await req.json()) as { userId?: string };
        if (!body.userId) {
            return NextResponse.json(
                { success: false, error: "userId is required" },
                { status: 400 }
            );
        }

        await removeOrganizationMember({
            organizationId: id,
            actorUserId: guard.user.id,
            userId: body.userId,
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: error.code === "NOT_FOUND" ? 404 : 403 }
            );
        }
        const message = error instanceof Error ? error.message : "Failed to remove member";
        console.error("DELETE /api/organizations/[id]/members error", error);
        const status = error instanceof ValidationError || message.includes("Cannot")
            ? 400
            : organizationApiErrorStatus(error);
        return NextResponse.json(
            { success: false, error: message },
            { status }
        );
    }
}
