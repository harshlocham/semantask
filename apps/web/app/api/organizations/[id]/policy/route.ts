import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/Db/db";
import { requireAuthUser } from "@/lib/utils/auth/requireAuthUser";
import {
    getOrganizationPolicyForViewer,
    serializeOrganizationPolicy,
    upsertOrganizationPolicy,
} from "@semantask/services/organization-policy.service";
import { AuthorizationError } from "@semantask/services/authorization.service";
import type { PromptGuardMode } from "@semantask/db/models/OrganizationPolicy";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    const { id } = await context.params;

    try {
        await connectToDatabase();
        const policy = await getOrganizationPolicyForViewer(id, guard.user.id);
        return NextResponse.json({
            success: true,
            data: serializeOrganizationPolicy(policy, id),
        });
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: error.code === "NOT_FOUND" ? 404 : 403 }
            );
        }
        console.error("GET /api/organizations/[id]/policy error", error);
        return NextResponse.json(
            { success: false, error: "Failed to load policy" },
            { status: 500 }
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
        const body = (await req.json()) as {
            confidenceThresholds?: Record<string, number> | null;
            allowedEmailDomains?: string[] | null;
            requireApprovalFor?: string[] | null;
            toolDenyList?: string[] | null;
            defaultToolGrants?: string[] | null;
            promptGuardMode?: PromptGuardMode | null;
        };

        const updated = await upsertOrganizationPolicy({
            organizationId: id,
            actorUserId: guard.user.id,
            ...body,
        });

        return NextResponse.json({
            success: true,
            data: serializeOrganizationPolicy(updated, id),
        });
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: error.code === "NOT_FOUND" ? 404 : 403 }
            );
        }
        const message = error instanceof Error ? error.message : "Failed to update policy";
        console.error("PUT /api/organizations/[id]/policy error", error);
        return NextResponse.json(
            { success: false, error: message },
            { status: message.includes("Invalid") ? 400 : 500 }
        );
    }
}
