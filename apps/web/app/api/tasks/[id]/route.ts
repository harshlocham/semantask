import { NextRequest, NextResponse } from "next/server";
import { withRequestCorrelation } from "@/lib/observability/with-correlation";
import { z } from "zod";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/Db/db";
import { requireAuthUser } from "@/lib/utils/auth/requireAuthUser";
import { requireTaskAccess } from "@/lib/utils/auth/requireConversationAccess";
import { updateTask } from "@/lib/repositories/task.repo";
import TaskModel from "@/models/Task";
import { normalizeTask } from "@/server/normalizers/task.normalizer";
import { enrichTaskForProduct } from "@semantask/services/task-product.service";
import { enqueueOutboxEvent } from "@/lib/services/outbox.service";
import {
    assertCanMutateCoordinationTask,
    AuthorizationError,
} from "@semantask/services/authorization.service";
import { resolveBoardStatus } from "@semantask/types";
import { escapeHtml } from "@semantask/services/html-escape";
import type { ITask } from "@semantask/db/models/Task";

const updateTaskBodySchema = z.object({
    title: z.string().min(3).max(200).optional(),
    description: z.string().max(8000).optional(),
    status: z.enum(["pending", "executing", "completed", "failed", "partial"]).optional(),
    boardStatus: z.enum(["todo", "doing", "done"]).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    assignees: z.array(z.string().min(1)).max(32).optional(),
    dueAt: z.coerce.date().nullable().optional(),
    tags: z.array(z.string().min(1).max(48)).optional(),
});

function forbiddenResponse() {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return withRequestCorrelation(req, async () => {
        try {
            const { id } = await params;
            const guard = await requireAuthUser();
            if (guard.response) return guard.response;

            if (!Types.ObjectId.isValid(id)) {
                return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
            }

            await connectToDatabase();

            const access = await requireTaskAccess(id, guard.user);
            if (access.response) return access.response;

            const task = await TaskModel.findById(id).lean();
            if (!task) {
                return NextResponse.json({ error: "Task not found" }, { status: 404 });
            }

            return NextResponse.json(await enrichTaskForProduct(task as ITask), { status: 200 });
        } catch (error) {
            console.error("GET /api/tasks/:id error", error);
            return NextResponse.json({ error: "Failed to load task" }, { status: 500 });
        }
    });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return withRequestCorrelation(req, async () => {
        try {
            const { id } = await params;
            const guard = await requireAuthUser();
            if (guard.response) return guard.response;

            await connectToDatabase();

            const body = updateTaskBodySchema.parse(await req.json());
            const hasBoardStatus = body.boardStatus !== undefined;
            const hasOtherFields = Object.entries(body).some(
                ([key, value]) => key !== "boardStatus" && value !== undefined
            );

            if (!hasBoardStatus && !hasOtherFields) {
                return NextResponse.json({ error: "No fields to update" }, { status: 400 });
            }

            const before = await TaskModel.findById(id).lean();
            if (!before) {
                return NextResponse.json({ error: "Task not found" }, { status: 404 });
            }

            if (hasOtherFields) {
                const access = await requireTaskAccess(id, guard.user);
                if (access.response) return access.response;
            }

            if (hasBoardStatus) {
                try {
                    await assertCanMutateCoordinationTask(
                        guard.user.id,
                        {
                            conversationId: before.conversationId.toString(),
                            organizationId: before.organizationId
                                ? before.organizationId.toString()
                                : null,
                        },
                        {
                            userRole: guard.user.role,
                            allowAdminBypass: true,
                        }
                    );
                } catch (error) {
                    if (error instanceof AuthorizationError) {
                        return forbiddenResponse();
                    }
                    throw error;
                }
            }

            const updated = await updateTask({
                taskId: id,
                ...body,
                updatedBy: guard.user.id,
            });

            if (!updated) {
                return NextResponse.json({ error: "Task not found" }, { status: 404 });
            }

            const normalized = normalizeTask(updated);

            await enqueueOutboxEvent({
                topic: "task.updated",
                dedupeKey: `task.updated:${normalized._id}:${normalized.updatedAt}`,
                payload: {
                    conversationId: normalized.conversationId,
                    socketPath: "/internal/task-updated",
                    socketPayload: {
                        taskId: normalized._id,
                        conversationId: normalized.conversationId,
                        patch: body,
                        previousVersion: before.version ?? 0,
                        newVersion: normalized.version,
                        updatedByType: "user",
                        updatedById: guard.user.id,
                    },
                },
            });

            const previousBoardStatus = resolveBoardStatus({
                boardStatus: before.boardStatus,
                status: before.status,
            });
            if (hasBoardStatus && body.boardStatus !== previousBoardStatus) {
                await enqueueOutboxEvent({
                    topic: "task.board.updated",
                    dedupeKey: `task.board.updated:${normalized._id}:${normalized.boardStatus}:${normalized.version}`,
                    payload: {
                        taskId: normalized._id,
                        conversationId: normalized.conversationId,
                        organizationId: before.organizationId
                            ? before.organizationId.toString()
                            : null,
                        boardStatus: normalized.boardStatus,
                        previousBoardStatus,
                        actorUserId: guard.user.id,
                    },
                });
            }

            if (Array.isArray(body.assignees) && body.assignees.length > 0) {
                const previousAssigneeIds = new Set(
                    (before.assignees ?? []).map((id) => id.toString())
                );
                const addedAssignees = body.assignees.filter(
                    (id: string) => id !== guard.user.id && !previousAssigneeIds.has(id)
                );
                if (addedAssignees.length > 0) {
                    const { notifyUsers } = await import("@semantask/services/notify.service");
                    const {
                        absoluteTaskHref,
                        withAbsoluteCta,
                        withAbsoluteCtaText,
                    } = await import("@semantask/services/notify-links");
                    const taskLink = absoluteTaskHref(normalized._id);
                    const text = `You were assigned "${normalized.title}".`;
                    const html = `<p>You were assigned <b>${escapeHtml(normalized.title)}</b>.</p>`;
                    await notifyUsers(
                        addedAssignees,
                        {
                            kind: "task_assigned",
                            subject: `Assigned: ${normalized.title}`,
                            text: withAbsoluteCtaText(text, taskLink, "Open task"),
                            html: withAbsoluteCta(html, taskLink, "Open task"),
                            dedupeKey: `assign-patch:${normalized._id}:${normalized.updatedAt}`,
                            conversationId: normalized.conversationId,
                            entityId: normalized._id,
                        }
                    ).catch((error) => console.error("task assign notify failed", error));
                }
            }

            return NextResponse.json(normalized, { status: 200 });
        } catch (error) {
            if (error instanceof z.ZodError) {
                return NextResponse.json({ error: "Invalid task update payload" }, { status: 400 });
            }
            console.error("PATCH /api/tasks/:id error", error);
            return NextResponse.json({ error: "Invalid task update payload" }, { status: 400 });
        }
    });
}
