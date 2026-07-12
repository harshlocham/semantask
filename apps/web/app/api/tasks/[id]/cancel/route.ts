import { NextRequest, NextResponse } from "next/server";
import { withRequestCorrelation } from "@/lib/observability/with-correlation";
import { z } from "zod";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/Db/db";
import { requireAuthUser } from "@/lib/utils/auth/requireAuthUser";
import { requireTaskAccess } from "@/lib/utils/auth/requireConversationAccess";
import TaskModel from "@/models/Task";
import { normalizeTask } from "@/server/normalizers/task.normalizer";
import { enqueueOutboxEvent } from "@/lib/services/outbox.service";

const cancelTaskBodySchema = z.object({
    reason: z.string().min(1).max(2000).optional(),
});

function isTaskTerminal(task: { lifecycleState?: string; status?: string }): boolean {
    return task.lifecycleState === "completed"
        || task.lifecycleState === "failed"
        || task.status === "completed"
        || task.status === "failed";
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return withRequestCorrelation(req, async () => {
        try {
            const { id } = await params;
            const guard = await requireAuthUser();
            if (guard.response) return guard.response;

            await connectToDatabase();

            const access = await requireTaskAccess(id, guard.user);
            if (access.response) return access.response;

            const body = cancelTaskBodySchema.parse(await req.json().catch(() => ({})));
            const reason = body.reason?.trim() || "Cancelled by user.";
            const requestedAt = new Date().toISOString();

            const existing = await TaskModel.findById(id).lean();
            if (!existing) {
                return NextResponse.json({ error: "Task not found" }, { status: 404 });
            }

            if (isTaskTerminal(existing)) {
                return NextResponse.json({ error: "Task is already terminal and cannot be cancelled." }, { status: 409 });
            }

            if (existing.cancelRequestedAt) {
                return NextResponse.json(normalizeTask(existing), { status: 200 });
            }

            const updated = await TaskModel.findOneAndUpdate(
                {
                    _id: id,
                    lifecycleState: { $nin: ["completed", "failed"] },
                    status: { $nin: ["completed", "failed"] },
                    cancelRequestedAt: null,
                },
                {
                    $set: {
                        cancelRequestedAt: new Date(requestedAt),
                        cancelReason: reason,
                        cancelRequestedByType: guard.user.role === "admin" ? "system" : "user",
                        cancelRequestedById: new Types.ObjectId(guard.user.id),
                    },
                },
                { new: true },
            ).exec();

            if (!updated) {
                const latest = await TaskModel.findById(id).lean();
                if (!latest) {
                    return NextResponse.json({ error: "Task not found" }, { status: 404 });
                }
                if (isTaskTerminal(latest)) {
                    return NextResponse.json({ error: "Task is already terminal and cannot be cancelled." }, { status: 409 });
                }
                return NextResponse.json(normalizeTask(latest), { status: 200 });
            }

            await enqueueOutboxEvent({
                topic: "task.cancel.requested",
                dedupeKey: `task.cancel.requested:${id}`,
                payload: {
                    taskId: id,
                    conversationId: updated.conversationId.toString(),
                    reason,
                    initiatedBy: guard.user.role === "admin" ? "system" : "user",
                    initiatedById: guard.user.id,
                    requestedAt,
                },
            });

            return NextResponse.json(normalizeTask(updated), { status: 202 });
        } catch (error) {
            console.error("POST /api/tasks/:id/cancel error", error);
            return NextResponse.json({ error: "Invalid task cancellation payload" }, { status: 400 });
        }

    });
}
