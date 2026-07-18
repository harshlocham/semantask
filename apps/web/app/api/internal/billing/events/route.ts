import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/Db/db";
import {
    hasValidInternalSecret,
    INTERNAL_SECRET_HEADER,
} from "@semantask/types/utils/internal-bridge-auth";
import OrganizationModel from "@semantask/db/models/Organization";
import { Types } from "mongoose";

/**
 * Billing provider callback stub (Phase 7.3).
 * Authenticated via worker internal secret. Can suspend/reactivate orgs
 * when a future billing provider posts subscription status.
 */
export async function POST(req: Request) {
    const providedSecret = req.headers.get(INTERNAL_SECRET_HEADER);
    if (!hasValidInternalSecret(providedSecret, "web")) {
        return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
    }

    let body: {
        type?: string;
        organizationId?: string;
        status?: "active" | "suspended";
        externalSubscriptionId?: string;
    };

    try {
        body = (await req.json()) as typeof body;
    } catch {
        return NextResponse.json({ success: false, error: "invalid_json" }, { status: 400 });
    }

    if (!body.organizationId || !Types.ObjectId.isValid(body.organizationId)) {
        return NextResponse.json({ success: false, error: "organizationId required" }, { status: 400 });
    }

    await connectToDatabase();

    if (body.type === "subscription.updated" || body.type === "subscription.status") {
        const status = body.status === "suspended" ? "suspended" : "active";
        const updated = await OrganizationModel.findByIdAndUpdate(
            body.organizationId,
            { $set: { status } },
            { new: true }
        ).lean();

        if (!updated) {
            return NextResponse.json({ success: false, error: "organization_not_found" }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            data: {
                organizationId: updated._id.toString(),
                status: updated.status,
                externalSubscriptionId: body.externalSubscriptionId ?? null,
            },
        });
    }

    // Acknowledge unknown event types for forward compatibility.
    return NextResponse.json({
        success: true,
        data: { acknowledged: true, type: body.type ?? null },
    });
}
