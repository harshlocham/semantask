import mongoose, { Document, Model, Schema } from "mongoose";

export interface IOrganizationQuota extends Document {
    _id: mongoose.Types.ObjectId;
    organizationId: mongoose.Types.ObjectId;
    /** Null = unlimited for that dimension. */
    maxTasksPerDay?: number | null;
    maxTokensPerMonth?: number | null;
    maxMembers?: number | null;
    createdAt: Date;
    updatedAt: Date;
}

const OrganizationQuotaSchema = new Schema<IOrganizationQuota>(
    {
        organizationId: {
            type: Schema.Types.ObjectId,
            ref: "Organization",
            required: true,
        },
        maxTasksPerDay: { type: Number, min: 0, default: null },
        maxTokensPerMonth: { type: Number, min: 0, default: null },
        maxMembers: { type: Number, min: 1, default: null },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

OrganizationQuotaSchema.index(
    { organizationId: 1 },
    { unique: true, name: "uniq_organization_quota" }
);

const OrganizationQuotaModel: Model<IOrganizationQuota> =
    (mongoose.models.OrganizationQuota as Model<IOrganizationQuota>)
    || mongoose.model<IOrganizationQuota>("OrganizationQuota", OrganizationQuotaSchema);

export default OrganizationQuotaModel;
