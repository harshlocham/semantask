import mongoose, { Document, Model, Schema } from "mongoose";

export interface IUsageEvent extends Document {
    _id: mongoose.Types.ObjectId;
    /** Null = personal workspace usage. */
    organizationId?: mongoose.Types.ObjectId | null;
    userId?: mongoose.Types.ObjectId | null;
    taskId?: mongoose.Types.ObjectId | null;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    /** LLM model id (named llmModel to avoid clashing with Document.model). */
    llmModel?: string | null;
    createdAt: Date;
}

const UsageEventSchema = new Schema<IUsageEvent>(
    {
        organizationId: {
            type: Schema.Types.ObjectId,
            ref: "Organization",
            default: null,
        },
        userId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
        taskId: { type: Schema.Types.ObjectId, ref: "Task", default: null, index: true },
        inputTokens: { type: Number, min: 0, default: 0 },
        outputTokens: { type: Number, min: 0, default: 0 },
        totalTokens: { type: Number, min: 0, default: 0 },
        llmModel: { type: String, trim: true, maxlength: 200, default: null },
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
        versionKey: false,
    }
);

UsageEventSchema.index(
    { organizationId: 1, createdAt: -1 },
    { name: "idx_usage_org_created" }
);
UsageEventSchema.index(
    { taskId: 1, createdAt: -1 },
    { name: "idx_usage_task_created" }
);

const UsageEventModel: Model<IUsageEvent> =
    (mongoose.models.UsageEvent as Model<IUsageEvent>)
    || mongoose.model<IUsageEvent>("UsageEvent", UsageEventSchema);

export default UsageEventModel;
