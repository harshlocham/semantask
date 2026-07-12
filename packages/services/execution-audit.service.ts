import { Types } from "mongoose";
import { connectToDatabase } from "@semantask/db";
import ExecutionAuditLogModel, {
    hashExecutionParams,
    type ExecutionAuditAction,
    type IExecutionAuditLog,
} from "@semantask/db/models/ExecutionAuditLog";

export type AppendExecutionAuditInput = {
    taskId: string;
    conversationId: string;
    actorId?: string | null;
    runId?: string | null;
    toolName: string;
    action: ExecutionAuditAction;
    parameters?: Record<string, unknown> | null;
    paramsHash?: string;
    externalIds?: Record<string, string>;
    decision?: string | null;
    reason?: string | null;
};

function isValidObjectId(value: string | null | undefined): value is string {
    return Boolean(value && Types.ObjectId.isValid(value));
}

/**
 * Append-only write. Never updates existing rows.
 * Best-effort: logs and returns null on failure so tool execution is not blocked
 * after a successful side effect (callers should prefer writing `started` before
 * side effects).
 */
export async function appendExecutionAudit(
    input: AppendExecutionAuditInput
): Promise<IExecutionAuditLog | null> {
    try {
        if (!isValidObjectId(input.taskId) || !isValidObjectId(input.conversationId)) {
            console.warn("execution_audit.invalid_ids", {
                taskId: input.taskId,
                conversationId: input.conversationId,
            });
            return null;
        }

        await connectToDatabase();

        const paramsHash = input.paramsHash ?? hashExecutionParams(input.parameters ?? {});

        return await ExecutionAuditLogModel.create({
            taskId: new Types.ObjectId(input.taskId),
            conversationId: new Types.ObjectId(input.conversationId),
            actorId: isValidObjectId(input.actorId) ? new Types.ObjectId(input.actorId) : null,
            runId: input.runId ?? null,
            toolName: input.toolName,
            action: input.action,
            paramsHash,
            externalIds: input.externalIds ?? {},
            decision: input.decision ?? null,
            reason: input.reason ?? null,
        });
    } catch (error) {
        console.error("execution_audit.write_failed", {
            taskId: input.taskId,
            toolName: input.toolName,
            action: input.action,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

export type ListExecutionAuditInput = {
    page?: number;
    limit?: number;
    taskId?: string;
    toolName?: string;
    action?: ExecutionAuditAction;
    actorId?: string;
};

export type ExecutionAuditListItem = {
    id: string;
    taskId: string;
    conversationId: string;
    actorId: string | null;
    runId: string | null;
    toolName: string;
    action: ExecutionAuditAction;
    paramsHash: string;
    externalIds: Record<string, string>;
    decision: string | null;
    reason: string | null;
    createdAt: string;
};

export async function listExecutionAudit(input: ListExecutionAuditInput = {}): Promise<{
    events: ExecutionAuditListItem[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
    const page = Number.isFinite(input.page) ? Math.max(1, Number(input.page)) : 1;
    const limit = Number.isFinite(input.limit) ? Math.min(100, Math.max(1, Number(input.limit))) : 20;

    await connectToDatabase();

    const query: Record<string, unknown> = {};
    if (isValidObjectId(input.taskId)) {
        query.taskId = new Types.ObjectId(input.taskId);
    }
    if (input.toolName) {
        query.toolName = input.toolName;
    }
    if (input.action) {
        query.action = input.action;
    }
    if (isValidObjectId(input.actorId)) {
        query.actorId = new Types.ObjectId(input.actorId);
    }

    const [total, rows] = await Promise.all([
        ExecutionAuditLogModel.countDocuments(query),
        ExecutionAuditLogModel.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean<IExecutionAuditLog[]>(),
    ]);

    return {
        events: rows.map((row) => ({
            id: row._id.toString(),
            taskId: row.taskId.toString(),
            conversationId: row.conversationId.toString(),
            actorId: row.actorId ? row.actorId.toString() : null,
            runId: row.runId ?? null,
            toolName: row.toolName,
            action: row.action,
            paramsHash: row.paramsHash,
            externalIds: (row.externalIds ?? {}) as Record<string, string>,
            decision: row.decision ?? null,
            reason: row.reason ?? null,
            createdAt: new Date(row.createdAt).toISOString(),
        })),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        },
    };
}

export { hashExecutionParams };
