import mongoose, { Document, Model, Schema } from "mongoose";

export const ORGANIZATION_MEMBER_ROLES = ["owner", "admin", "member"] as const;
export type OrganizationMemberRole = (typeof ORGANIZATION_MEMBER_ROLES)[number];

export interface IOrganizationMembership extends Document {
    _id: mongoose.Types.ObjectId;
    organizationId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    role: OrganizationMemberRole;
    createdAt: Date;
    updatedAt: Date;
}

const OrganizationMembershipSchema = new Schema<IOrganizationMembership>(
    {
        organizationId: {
            type: Schema.Types.ObjectId,
            ref: "Organization",
            required: true,
            index: true,
        },
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
        role: {
            type: String,
            enum: ORGANIZATION_MEMBER_ROLES,
            required: true,
            default: "member",
            index: true,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

OrganizationMembershipSchema.index(
    { organizationId: 1, userId: 1 },
    { unique: true, name: "uniq_organization_membership" }
);
OrganizationMembershipSchema.index(
    { userId: 1, organizationId: 1 },
    { name: "idx_membership_user_org" }
);

const OrganizationMembershipModel: Model<IOrganizationMembership> =
    (mongoose.models.OrganizationMembership as Model<IOrganizationMembership>)
    || mongoose.model<IOrganizationMembership>(
        "OrganizationMembership",
        OrganizationMembershipSchema
    );

export default OrganizationMembershipModel;
