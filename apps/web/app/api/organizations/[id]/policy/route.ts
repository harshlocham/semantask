import { NextResponse } from "next/server";
import { z } from "zod";
import { connectToDatabase } from "@/lib/Db/db";
import { requireAuthUser } from "@/lib/utils/auth/requireAuthUser";
import {
    getOrganizationPolicyForViewer,
    serializeOrganizationPolicy,
    upsertOrganizationPolicy,
} from "@semantask/services/organization-policy.service";
import { AuthorizationError } from "@semantask/services/authorization.service";
import { PROMPT_GUARD_MODES } from "@semantask/db/models/OrganizationPolicy";
import {
    organizationApiErrorStatus,
    ValidationError,
} from "@semantask/services/organization-errors";

type RouteContext = { params: Promise<{ id: string }> };

const organizationPolicyBodySchema = z.object({
    confidenceThresholds: z.record(z.string(), z.number()).nullable().optional(),
    allowedEmailDomains: z.array(z.string()).nullable().optional(),
    requireApprovalFor: z.array(z.string()).nullable().optional(),
    toolDenyList: z.array(z.string()).nullable().optional(),
    defaultToolGrants: z.array(z.string()).nullable().optional(),
    promptGuardMode: z.enum(PROMPT_GUARD_MODES).nullable().optional(),
}).strict();

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
        const parsed = organizationPolicyBodySchema.safeParse(await req.json());
        if (!parsed.success) {
            throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid policy body");
        }

        const updated = await upsertOrganizationPolicy({
            ...parsed.data,
            organizationId: id,
            actorUserId: guard.user.id,
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
            { status: organizationApiErrorStatus(error) }
        );
    }
}
