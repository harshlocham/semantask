import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@semantask/observability/logger";

const logger = createLogger("web-rum");

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ ok: false }, { status: 400 });
        }

        const name = typeof (body as { name?: unknown }).name === "string"
            ? (body as { name: string }).name
            : "unknown";
        const duration = typeof (body as { duration?: unknown }).duration === "number"
            ? (body as { duration: number }).duration
            : undefined;

        logger.info({
            event: "rum.metric",
            name,
            durationMs: duration,
            timestamp: (body as { timestamp?: unknown }).timestamp,
        });

        return NextResponse.json({ ok: true }, { status: 202 });
    } catch {
        return NextResponse.json({ ok: false }, { status: 500 });
    }
}
