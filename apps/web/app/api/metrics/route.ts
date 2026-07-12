import { NextRequest, NextResponse } from "next/server";
import {
    ensureDefaultMetrics,
    prometheusContentType,
    renderPrometheusMetrics,
} from "@semantask/observability/metrics";

ensureDefaultMetrics("web");

export async function GET(_req: NextRequest) {
    const body = await renderPrometheusMetrics();
    return new NextResponse(body, {
        status: 200,
        headers: {
            "Content-Type": prometheusContentType(),
        },
    });
}
