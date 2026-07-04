import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/Db/db";
import { requireAdminUser } from "@/lib/utils/auth/requireAdminUser";
import { listAuthEvents, type AdminAuthEventGroup } from "@semantask/auth";

const ADMIN_EVENT_TYPES: AdminAuthEventGroup[] = ["LOGIN", "REFRESH", "REVOKE", "STEP_UP"];

function parsePositiveInt(value: string | null, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseDateRange(dateValue: string | null): { dateFrom?: Date; dateTo?: Date } {
    if (!dateValue) {
        return {};
    }

    const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateOnlyPattern.test(dateValue)) {
        return {};
    }

    const dateFrom = new Date(`${dateValue}T00:00:00.000Z`);
    if (Number.isNaN(dateFrom.getTime())) {
        return {};
    }

    const dateTo = new Date(`${dateValue}T23:59:59.999Z`);
    return { dateFrom, dateTo };
}

export async function GET(req: Request) {
    const guard = await requireAdminUser();
    if (guard.response) {
        return guard.response;
    }

    const url = new URL(req.url);
    const eventTypeParam = url.searchParams.get("eventType");
    const eventType = ADMIN_EVENT_TYPES.includes(eventTypeParam as AdminAuthEventGroup)
        ? (eventTypeParam as AdminAuthEventGroup)
        : undefined;

    const page = parsePositiveInt(url.searchParams.get("page"), 1);
    const limit = parsePositiveInt(url.searchParams.get("limit"), 20);
    const userId = url.searchParams.get("userId") || undefined;
    const { dateFrom, dateTo } = parseDateRange(url.searchParams.get("date"));

    try {
        await connectToDatabase();

        const result = await listAuthEvents({
            page,
            limit,
            eventType,
            userId,
            dateFrom,
            dateTo,
        });

        return NextResponse.json({
            success: true,
            data: result,
        });
    } catch (error) {
        console.error("Failed to fetch admin auth events", error);
        return NextResponse.json(
            { success: false, error: "Failed to fetch auth events" },
            { status: 500 }
        );
    }
}
