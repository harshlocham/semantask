import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/Db/db";
import { requireAuthUser } from "@/lib/utils/auth/requireAuthUser";
import {
    createOrganization,
    listOrganizationsForUser,
    serializeOrganization,
} from "@semantask/services/organization.service";
import { AuthorizationError } from "@semantask/services/authorization.service";

export async function GET() {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    try {
        await connectToDatabase();
        const entries = await listOrganizationsForUser(guard.user.id);
        return NextResponse.json({
            success: true,
            data: entries.map((entry) => ({
                ...serializeOrganization(entry.organization),
                role: entry.role,
            })),
        });
    } catch (error) {
        console.error("GET /api/organizations error", error);
        return NextResponse.json(
            { success: false, error: "Failed to list organizations" },
            { status: 500 }
        );
    }
}

export async function POST(req: Request) {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    try {
        await connectToDatabase();
        const body = (await req.json()) as { name?: string; slug?: string };
        if (!body.name || typeof body.name !== "string") {
            return NextResponse.json(
                { success: false, error: "name is required" },
                { status: 400 }
            );
        }

        const result = await createOrganization({
            name: body.name,
            slug: body.slug,
            createdBy: guard.user.id,
        });

        return NextResponse.json(
            {
                success: true,
                data: {
                    ...serializeOrganization(result.organization),
                    role: result.membership.role,
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
        const message = error instanceof Error ? error.message : "Failed to create organization";
        const status = message.includes("already taken") || message.includes("Invalid") ? 400 : 500;
        console.error("POST /api/organizations error", error);
        return NextResponse.json({ success: false, error: message }, { status });
    }
}
