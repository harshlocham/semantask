import mongoose, { Document, Model, Schema } from "mongoose";

export const HIGH_RISK_TOOLS = ["send_email", "schedule_meeting", "create_github_issue"] as const;
export type HighRiskToolName = (typeof HIGH_RISK_TOOLS)[number];

export function isHighRiskToolName(value: string): value is HighRiskToolName {
    return (HIGH_RISK_TOOLS as readonly string[]).includes(value);
}

export interface IToolGrant extends Document {
    _id: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    /** Null / missing = global grant for this user+tool. */
    conversationId?: mongoose.Types.ObjectId | null;
    /** Null / missing = personal/global grant; set = org-scoped. */
    organizationId?: mongoose.Types.ObjectId | null;
    toolName: HighRiskToolName;
    grantedBy: mongoose.Types.ObjectId;
    revokedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const ToolGrantSchema = new Schema<IToolGrant>(
    {
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
        conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", default: null, index: true },
        organizationId: { type: Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
        toolName: {
            type: String,
            enum: HIGH_RISK_TOOLS,
            required: true,
            index: true,
        },
        grantedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
        revokedAt: { type: Date, default: null, index: true },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

// One active grant per (user, tool, conversation, org scope).
ToolGrantSchema.index(
    { userId: 1, toolName: 1, conversationId: 1, organizationId: 1 },
    {
        unique: true,
        partialFilterExpression: { revokedAt: null },
        name: "uniq_active_tool_grant",
    }
);

ToolGrantSchema.index({ userId: 1, revokedAt: 1 }, { name: "idx_tool_grant_user_active" });
ToolGrantSchema.index(
    { organizationId: 1, userId: 1, revokedAt: 1 },
    { name: "idx_tool_grant_org_user_active" }
);

const ToolGrantModel: Model<IToolGrant> =
    (mongoose.models.ToolGrant as Model<IToolGrant>) || mongoose.model<IToolGrant>("ToolGrant", ToolGrantSchema);

export default ToolGrantModel;
