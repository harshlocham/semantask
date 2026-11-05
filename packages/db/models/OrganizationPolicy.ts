import mongoose, { Document, Model, Schema } from "mongoose";

export const PROMPT_GUARD_MODES = ["off", "monitor", "enforce"] as const;
export type PromptGuardMode = (typeof PROMPT_GUARD_MODES)[number];

/** Mirrors `@semantask/types` ExecutionMode — kept local so `@semantask/db` stays types-free. */
export const EXECUTION_MODES = ["suggest_only", "require_approval", "auto_execute"] as const;
export type OrganizationExecutionMode = (typeof EXECUTION_MODES)[number];

/** Per-tool autonomy. `off` denies the tool; the other values match execution mode. */
export const TOOL_AUTONOMY_MODES = ["off", "suggest_only", "require_approval", "auto_execute"] as const;
export type ToolAutonomyMode = (typeof TOOL_AUTONOMY_MODES)[number];

export const POLICY_TOOL_NAMES = ["send_email", "schedule_meeting", "create_github_issue"] as const;
export type PolicyToolName = (typeof POLICY_TOOL_NAMES)[number];

export interface IOrganizationPolicy extends Document {
    _id: mongoose.Types.ObjectId;
    organizationId: mongoose.Types.ObjectId;
    version: number;
    /** Per-intent confidence thresholds; missing keys inherit code defaults. */
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
    /** Workspace execution mode; missing → treat as suggest_only on read. */
    executionMode?: OrganizationExecutionMode | null;
    /**
     * Per high-risk tool autonomy. Missing keys inherit the org execution mode.
     * `auto_execute` follows the org path and cannot loosen `suggest_only`.
     */
    toolExecutionModes?: Partial<Record<PolicyToolName, ToolAutonomyMode>> | null;
    executionModeUpdatedAt?: Date | null;
    executionModeUpdatedBy?: mongoose.Types.ObjectId | null;
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
        executionMode: {
            type: String,
            enum: EXECUTION_MODES,
            default: null,
        },
        toolExecutionModes: { type: Schema.Types.Mixed, default: null },
        executionModeUpdatedAt: { type: Date, default: null },
        executionModeUpdatedBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
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
