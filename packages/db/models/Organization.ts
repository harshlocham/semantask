import mongoose, { Document, Model, Schema } from "mongoose";

export const ORGANIZATION_STATUSES = ["active", "suspended"] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export interface IOrganization extends Document {
    _id: mongoose.Types.ObjectId;
    name: string;
    slug: string;
    status: OrganizationStatus;
    createdBy: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const OrganizationSchema = new Schema<IOrganization>(
    {
        name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
        slug: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            minlength: 2,
            maxlength: 64,
            match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        },
        status: {
            type: String,
            enum: ORGANIZATION_STATUSES,
            default: "active",
            index: true,
        },
        createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

OrganizationSchema.index({ slug: 1 }, { unique: true, name: "uniq_organization_slug" });
OrganizationSchema.index({ status: 1, updatedAt: -1 }, { name: "idx_organization_status_updated" });

const OrganizationModel: Model<IOrganization> =
    (mongoose.models.Organization as Model<IOrganization>)
    || mongoose.model<IOrganization>("Organization", OrganizationSchema);

export default OrganizationModel;
