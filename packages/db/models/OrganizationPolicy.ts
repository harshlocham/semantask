import mongoose, { Document, Model, Schema } from "mongoose";

export const PROMPT_GUARD_MODES = ["off", "monitor", "enforce"] as const;
export type PromptGuardMode = (typeof PROMPT_GUARD_MODES)[number];

export interface IOrganizationPolicy extends Document {
    _id: mongoose.Types.ObjectId;
    organizationId: mongoose.Types.ObjectId;
    version: number;
    /** Per-intent confidence thresholds; missing keys inherit env defaults. */
    confidenceThresholds?: Record<string, number> | null;
    /** Override process email domain allowlist when non-empty. */
    allowedEmailDomains?: string[] | null;
    /** Tools that always require approval in this org. */
    requireApprovalFor?: string[] | null;
    /** Tools denied for the whole org (checked before grants). */
    toolDenyList?: string[] | null;
    /** Default high-risk tools granted to all members when ToolGrant missing. */
    defaultToolGrants?: string[] | null;
    promptGuardMode?: PromptGuardMode | null;
    createdAt: Date;
    updatedAt: Date;
}

const OrganizationPolicySchema = new Schema<IOrganizationPolicy>(
    {
        organizationId: {
            type: Schema.Types.ObjectId,
            ref: "Organization",
            required: true,
        },
        version: { type: Number, min: 1, default: 1 },
        confidenceThresholds: { type: Schema.Types.Mixed, default: null },
        allowedEmailDomains: { type: [String], default: null },
        requireApprovalFor: { type: [String], default: null },
        toolDenyList: { type: [String], default: null },
        defaultToolGrants: { type: [String], default: null },
        promptGuardMode: {
            type: String,
            enum: PROMPT_GUARD_MODES,
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

OrganizationPolicySchema.index(
    { organizationId: 1 },
    { unique: true, name: "uniq_organization_policy" }
);

const OrganizationPolicyModel: Model<IOrganizationPolicy> =
    (mongoose.models.OrganizationPolicy as Model<IOrganizationPolicy>)
    || mongoose.model<IOrganizationPolicy>("OrganizationPolicy", OrganizationPolicySchema);

export default OrganizationPolicyModel;
