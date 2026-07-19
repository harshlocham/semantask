import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/Db/db";
import { requireAuthUser } from "@/lib/utils/auth/requireAuthUser";
import {
    assertCanManageMembers,
    assertMembership,
} from "@semantask/services/organization.service";
import {
    getOrganizationQuota,
    upsertOrganizationQuota,
} from "@semantask/services/organization-quota.service";
import { AuthorizationError } from "@semantask/services/authorization.service";
import {
    organizationApiErrorStatus,
    ValidationError,
} from "@semantask/services/organization-errors";

type RouteContext = { params: Promise<{ id: string }> };

function serializeQuota(
    organizationId: string,
    quota: Awaited<ReturnType<typeof getOrganizationQuota>>
) {
    if (!quota) {
        return {
            organizationId,
            maxTasksPerDay: null,
            maxTokensPerMonth: null,
            maxMembers: null,
        };
    }

    return {
        organizationId: quota.organizationId.toString(),
        maxTasksPerDay: quota.maxTasksPerDay ?? null,
        maxTokensPerMonth: quota.maxTokensPerMonth ?? null,
        maxMembers: quota.maxMembers ?? null,
        updatedAt: quota.updatedAt?.toISOString?.() ?? null,
    };
}

export async function GET(_req: Request, context: RouteContext) {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    const { id } = await context.params;

    try {
        await connectToDatabase();
        await assertMembership(id, guard.user.id);
        const quota = await getOrganizationQuota(id);
        return NextResponse.json({
            success: true,
            data: serializeQuota(id, quota),
        });
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: error.code === "NOT_FOUND" ? 404 : 403 }
            );
        }
        console.error("GET /api/organizations/[id]/quota error", error);
        return NextResponse.json(
            { success: false, error: "Failed to load quota" },
            { status: organizationApiErrorStatus(error) }
        );
    }
}

export async function PUT(req: Request, context: RouteContext) {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    const { id } = await context.params;

    try {
        await connectToDatabase();
        await assertCanManageMembers(id, guard.user.id);
        const body = (await req.json()) as {
            maxTasksPerDay?: number | null;
            maxTokensPerMonth?: number | null;
            maxMembers?: number | null;
        };

        const updated = await upsertOrganizationQuota({
            organizationId: id,
            maxTasksPerDay: body.maxTasksPerDay,
            maxTokensPerMonth: body.maxTokensPerMonth,
            maxMembers: body.maxMembers,
        });

        return NextResponse.json({
            success: true,
            data: serializeQuota(id, updated),
        });
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: error.code === "NOT_FOUND" ? 404 : 403 }
            );
        }
        const message = error instanceof Error ? error.message : "Failed to update quota";
        console.error("PUT /api/organizations/[id]/quota error", error);
        const isValidation = error instanceof ValidationError
            || (error as { name?: string })?.name === "ValidationError";
        return NextResponse.json(
            { success: false, error: message },
            { status: isValidation ? 400 : organizationApiErrorStatus(error) }
        );
    }
}
