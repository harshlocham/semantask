import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/Db/db";
import { requireAdminUser } from "@/lib/utils/auth/requireAdminUser";
import {
    listExecutionAudit,
    type ExecutionAuditAction,
} from "@semantask/services/execution-audit.service";
import { EXECUTION_AUDIT_ACTIONS } from "@semantask/db/models/ExecutionAuditLog";

function parsePositiveInt(value: string | null, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isAuditAction(value: string | null): value is ExecutionAuditAction {
    return Boolean(value && (EXECUTION_AUDIT_ACTIONS as readonly string[]).includes(value));
}

export async function GET(req: Request) {
    const guard = await requireAdminUser();
    if (guard.response) {
        return guard.response;
    }

    const url = new URL(req.url);
    const page = parsePositiveInt(url.searchParams.get("page"), 1);
    const limit = parsePositiveInt(url.searchParams.get("limit"), 20);
    const taskId = url.searchParams.get("taskId") || undefined;
    const toolName = url.searchParams.get("tool") || url.searchParams.get("toolName") || undefined;
    const actorId = url.searchParams.get("actorId") || undefined;
    const actionParam = url.searchParams.get("action");
    const action = isAuditAction(actionParam) ? actionParam : undefined;

    try {
        await connectToDatabase();
        const result = await listExecutionAudit({
            page,
            limit,
            taskId,
            toolName,
            actorId,
            action,
        });

        return NextResponse.json({ success: true, data: result });
    } catch (error) {
        console.error("Failed to list execution audit", error);
        return NextResponse.json(
            { success: false, error: "Failed to list execution audit" },
            { status: 500 }
        );
    }
}
