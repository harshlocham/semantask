import { createHash } from "node:crypto";
import mongoose, { Document, Model, Schema } from "mongoose";

export const EXECUTION_AUDIT_ACTIONS = [
    "requested",
    "started",
    "completed",
    "failed",
    "denied",
] as const;

export type ExecutionAuditAction = (typeof EXECUTION_AUDIT_ACTIONS)[number];

export interface IExecutionAuditLog extends Document {
    _id: mongoose.Types.ObjectId;
    taskId: mongoose.Types.ObjectId;
    conversationId: mongoose.Types.ObjectId;
    /** Denormalized for org-scoped audit queries. */
    organizationId?: mongoose.Types.ObjectId | null;
    actorId?: mongoose.Types.ObjectId | null;
    runId?: string | null;
    toolName: string;
    action: ExecutionAuditAction;
    paramsHash: string;
    externalIds: Record<string, string>;
    decision?: string | null;
    reason?: string | null;
    createdAt: Date;
}

const ExecutionAuditLogSchema = new Schema<IExecutionAuditLog>(
    {
        taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true, index: true },
        conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
        organizationId: { type: Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
        actorId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
        runId: { type: String, trim: true, maxlength: 200, default: null, index: true },
        toolName: { type: String, required: true, trim: true, maxlength: 120, index: true },
        action: {
            type: String,
            enum: EXECUTION_AUDIT_ACTIONS,
            required: true,
            index: true,
        },
        paramsHash: { type: String, required: true, maxlength: 128 },
        externalIds: { type: Schema.Types.Mixed, default: {} },
        decision: { type: String, trim: true, maxlength: 200, default: null },
        reason: { type: String, trim: true, maxlength: 2000, default: null },
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
        versionKey: false,
    }
);

ExecutionAuditLogSchema.pre("updateOne", function () {
    throw new Error("ExecutionAuditLog is append-only; updates are not allowed");
});
ExecutionAuditLogSchema.pre("updateMany", function () {
    throw new Error("ExecutionAuditLog is append-only; updates are not allowed");
});
ExecutionAuditLogSchema.pre("findOneAndUpdate", function () {
    throw new Error("ExecutionAuditLog is append-only; updates are not allowed");
});
ExecutionAuditLogSchema.pre("findOneAndReplace", function () {
    throw new Error("ExecutionAuditLog is append-only; updates are not allowed");
});
ExecutionAuditLogSchema.pre("replaceOne", function () {
    throw new Error("ExecutionAuditLog is append-only; updates are not allowed");
});
ExecutionAuditLogSchema.pre("deleteOne", function () {
    throw new Error("ExecutionAuditLog is append-only; deletes are not allowed");
});
ExecutionAuditLogSchema.pre("deleteMany", function () {
    throw new Error("ExecutionAuditLog is append-only; deletes are not allowed");
});
ExecutionAuditLogSchema.pre("findOneAndDelete", function () {
    throw new Error("ExecutionAuditLog is append-only; deletes are not allowed");
});

ExecutionAuditLogSchema.pre("bulkWrite", function (_next, ops: unknown) {
    const operations = Array.isArray(ops) ? ops : [];
    for (const op of operations) {
        if (!op || typeof op !== "object") {
            throw new Error("ExecutionAuditLog is append-only; invalid bulkWrite operation");
        }
        const keys = Object.keys(op as Record<string, unknown>);
        const destructive = keys.some((key) =>
            key === "updateOne"
            || key === "updateMany"
            || key === "replaceOne"
            || key === "deleteOne"
            || key === "deleteMany"
        );
        if (destructive) {
            throw new Error("ExecutionAuditLog is append-only; bulkWrite updates/replaces/deletes are not allowed");
        }
        const allowed = keys.every((key) => key === "insertOne");
        if (!allowed) {
            throw new Error("ExecutionAuditLog is append-only; bulkWrite only allows insertOne");
        }
    }
});

ExecutionAuditLogSchema.pre("save", function (next) {
    if (!this.isNew) {
        next(new Error("ExecutionAuditLog is append-only; document updates are not allowed"));
        return;
    }
    next();
});

ExecutionAuditLogSchema.index({ taskId: 1, createdAt: -1 }, { name: "idx_execution_audit_task_created" });
ExecutionAuditLogSchema.index({ toolName: 1, createdAt: -1 }, { name: "idx_execution_audit_tool_created" });
ExecutionAuditLogSchema.index(
    { organizationId: 1, createdAt: -1 },
    { name: "idx_execution_audit_org_created" }
);

/** Stable JSON hash for tool parameters (sorted keys). */
export function hashExecutionParams(params: Record<string, unknown> | null | undefined): string {
    const canonical = canonicalize(params ?? {});
    return createHash("sha256").update(canonical).digest("hex");
}

function canonicalize(value: unknown): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
    }

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
}

const ExecutionAuditLogModel: Model<IExecutionAuditLog> =
    (mongoose.models.ExecutionAuditLog as Model<IExecutionAuditLog>)
    || mongoose.model<IExecutionAuditLog>("ExecutionAuditLog", ExecutionAuditLogSchema);

export default ExecutionAuditLogModel;
