import { Types } from "mongoose";
import { connectToDatabase } from "@semantask/db";
import OrganizationModel, {
    type IOrganization,
    type OrganizationStatus,
} from "@semantask/db/models/Organization";
import OrganizationMembershipModel, {
    ORGANIZATION_MEMBER_ROLES,
    type IOrganizationMembership,
    type OrganizationMemberRole,
} from "@semantask/db/models/OrganizationMembership";
import { AuthorizationError } from "./authorization-errors";

export const ORGANIZATION_ID_HEADER = "x-organization-id";

export type { OrganizationMemberRole, OrganizationStatus };

function isValidObjectId(value: string | null | undefined): value is string {
    return Boolean(value && Types.ObjectId.isValid(value));
}

function slugify(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);
}

export function canManageMembers(role: OrganizationMemberRole): boolean {
    return role === "owner" || role === "admin";
}

export async function getMembership(
    organizationId: string,
    userId: string
): Promise<IOrganizationMembership | null> {
    if (!isValidObjectId(organizationId) || !isValidObjectId(userId)) {
        return null;
    }

    await connectToDatabase();

    return OrganizationMembershipModel.findOne({
        organizationId: new Types.ObjectId(organizationId),
        userId: new Types.ObjectId(userId),
    }).lean<IOrganizationMembership>();
}

export async function assertMembership(
    organizationId: string,
    userId: string
): Promise<IOrganizationMembership> {
    const membership = await getMembership(organizationId, userId);
    if (!membership) {
        throw new AuthorizationError("FORBIDDEN", "Forbidden");
    }
    return membership;
}

export async function assertCanManageMembers(
    organizationId: string,
    userId: string
): Promise<IOrganizationMembership> {
    const membership = await assertMembership(organizationId, userId);
    if (!canManageMembers(membership.role)) {
        throw new AuthorizationError("FORBIDDEN", "Forbidden");
    }
    return membership;
}

export async function getOrganizationById(
    organizationId: string
): Promise<IOrganization | null> {
    if (!isValidObjectId(organizationId)) {
        return null;
    }

    await connectToDatabase();
    return OrganizationModel.findById(organizationId).lean<IOrganization>();
}

export async function assertOrganizationActive(
    organizationId: string
): Promise<IOrganization> {
    const org = await getOrganizationById(organizationId);
    if (!org) {
        throw new AuthorizationError("NOT_FOUND", "Organization not found");
    }
    if (org.status === "suspended") {
        throw new AuthorizationError("FORBIDDEN", "Organization is suspended");
    }
    return org;
}

export type CreateOrganizationInput = {
    name: string;
    slug?: string;
    createdBy: string;
};

export async function createOrganization(
    input: CreateOrganizationInput
): Promise<{ organization: IOrganization; membership: IOrganizationMembership }> {
    if (!isValidObjectId(input.createdBy)) {
        throw new AuthorizationError("FORBIDDEN", "Invalid user");
    }

    const name = input.name.trim();
    if (name.length < 1 || name.length > 120) {
        throw new Error("Organization name must be 1–120 characters");
    }

    const slug = (input.slug?.trim().toLowerCase() || slugify(name));
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 2) {
        throw new Error("Invalid organization slug");
    }

    await connectToDatabase();

    const existing = await OrganizationModel.findOne({ slug }).select("_id").lean();
    if (existing) {
        throw new Error("Organization slug already taken");
    }

    const organization = await OrganizationModel.create({
        name,
        slug,
        status: "active",
        createdBy: new Types.ObjectId(input.createdBy),
    });

    const membership = await OrganizationMembershipModel.create({
        organizationId: organization._id,
        userId: new Types.ObjectId(input.createdBy),
        role: "owner",
    });

    return {
        organization: organization.toObject() as IOrganization,
        membership: membership.toObject() as IOrganizationMembership,
    };
}

export async function listOrganizationsForUser(userId: string): Promise<Array<{
    organization: IOrganization;
    role: OrganizationMemberRole;
}>> {
    if (!isValidObjectId(userId)) {
        return [];
    }

    await connectToDatabase();

    const memberships = await OrganizationMembershipModel.find({
        userId: new Types.ObjectId(userId),
    })
        .lean<IOrganizationMembership[]>();

    if (memberships.length === 0) {
        return [];
    }

    const orgIds = memberships.map((m) => m.organizationId);
    const orgs = await OrganizationModel.find({ _id: { $in: orgIds } })
        .lean<IOrganization[]>();
    const orgById = new Map(orgs.map((org) => [org._id.toString(), org]));

    return memberships
        .map((membership) => {
            const organization = orgById.get(membership.organizationId.toString());
            if (!organization) return null;
            return { organization, role: membership.role };
        })
        .filter((entry): entry is { organization: IOrganization; role: OrganizationMemberRole } =>
            Boolean(entry)
        );
}

export type UpdateOrganizationInput = {
    organizationId: string;
    actorUserId: string;
    name?: string;
    status?: OrganizationStatus;
};

export async function updateOrganization(
    input: UpdateOrganizationInput
): Promise<IOrganization> {
    const membership = await assertCanManageMembers(input.organizationId, input.actorUserId);

    if (input.status !== undefined && membership.role !== "owner") {
        throw new AuthorizationError("FORBIDDEN", "Only owners can change organization status");
    }

    await connectToDatabase();

    const updates: Partial<{ name: string; status: OrganizationStatus }> = {};
    if (typeof input.name === "string") {
        const name = input.name.trim();
        if (name.length < 1 || name.length > 120) {
            throw new Error("Organization name must be 1–120 characters");
        }
        updates.name = name;
    }
    if (input.status) {
        updates.status = input.status;
    }

    const updated = await OrganizationModel.findByIdAndUpdate(
        input.organizationId,
        { $set: updates },
        { new: true }
    ).lean<IOrganization>();

    if (!updated) {
        throw new AuthorizationError("NOT_FOUND", "Organization not found");
    }

    return updated;
}

export type AddMemberInput = {
    organizationId: string;
    actorUserId: string;
    userId: string;
    role?: OrganizationMemberRole;
};

export async function addOrganizationMember(
    input: AddMemberInput
): Promise<IOrganizationMembership> {
    await assertCanManageMembers(input.organizationId, input.actorUserId);
    await assertOrganizationActive(input.organizationId);

    if (!isValidObjectId(input.userId)) {
        throw new AuthorizationError("FORBIDDEN", "Invalid user");
    }

    const role = input.role ?? "member";
    if (!ORGANIZATION_MEMBER_ROLES.includes(role)) {
        throw new Error("Invalid membership role");
    }
    if (role === "owner") {
        throw new Error("Cannot add another owner; transfer ownership separately");
    }

    await connectToDatabase();

    const existing = await OrganizationMembershipModel.findOne({
        organizationId: new Types.ObjectId(input.organizationId),
        userId: new Types.ObjectId(input.userId),
    });

    if (existing) {
        return existing.toObject() as IOrganizationMembership;
    }

    const membership = await OrganizationMembershipModel.create({
        organizationId: new Types.ObjectId(input.organizationId),
        userId: new Types.ObjectId(input.userId),
        role,
    });

    return membership.toObject() as IOrganizationMembership;
}

export async function listOrganizationMembers(
    organizationId: string,
    actorUserId: string
): Promise<Array<{
    id: string;
    userId: string;
    role: OrganizationMemberRole;
    createdAt: string;
}>> {
    await assertMembership(organizationId, actorUserId);
    await connectToDatabase();

    const members = await OrganizationMembershipModel.find({
        organizationId: new Types.ObjectId(organizationId),
    })
        .sort({ createdAt: 1 })
        .lean<IOrganizationMembership[]>();

    return members.map((member) => ({
        id: member._id.toString(),
        userId: member.userId.toString(),
        role: member.role,
        createdAt: member.createdAt.toISOString(),
    }));
}

export async function removeOrganizationMember(input: {
    organizationId: string;
    actorUserId: string;
    userId: string;
}): Promise<void> {
    await assertCanManageMembers(input.organizationId, input.actorUserId);

    if (!isValidObjectId(input.userId)) {
        throw new AuthorizationError("FORBIDDEN", "Invalid user");
    }

    await connectToDatabase();

    const target = await OrganizationMembershipModel.findOne({
        organizationId: new Types.ObjectId(input.organizationId),
        userId: new Types.ObjectId(input.userId),
    });

    if (!target) {
        throw new AuthorizationError("NOT_FOUND", "Membership not found");
    }

    if (target.role === "owner") {
        throw new Error("Cannot remove the organization owner");
    }

    await OrganizationMembershipModel.deleteOne({ _id: target._id });
}

export async function assertUsersAreOrgMembers(
    organizationId: string,
    userIds: string[]
): Promise<void> {
    if (!isValidObjectId(organizationId)) {
        throw new AuthorizationError("FORBIDDEN", "Forbidden");
    }

    const uniqueIds = Array.from(new Set(userIds.filter(isValidObjectId)));
    if (uniqueIds.length === 0) {
        return;
    }

    await connectToDatabase();

    const count = await OrganizationMembershipModel.countDocuments({
        organizationId: new Types.ObjectId(organizationId),
        userId: { $in: uniqueIds.map((id) => new Types.ObjectId(id)) },
    });

    if (count !== uniqueIds.length) {
        throw new AuthorizationError(
            "FORBIDDEN",
            "All participants must be organization members"
        );
    }
}

/**
 * Resolve active org from header value. Empty/missing = personal workspace (null).
 * When set, requires active membership for the user.
 */
export async function resolveOrganizationIdForUser(
    userId: string,
    organizationIdHeader: string | null | undefined
): Promise<string | null> {
    const raw = organizationIdHeader?.trim();
    if (!raw) {
        return null;
    }

    if (!isValidObjectId(raw)) {
        throw new AuthorizationError("FORBIDDEN", "Invalid organization context");
    }

    await assertMembership(raw, userId);
    await assertOrganizationActive(raw);
    return raw;
}

export function serializeOrganization(org: IOrganization) {
    return {
        id: org._id.toString(),
        name: org.name,
        slug: org.slug,
        status: org.status,
        createdBy: org.createdBy.toString(),
        createdAt: org.createdAt.toISOString(),
        updatedAt: org.updatedAt.toISOString(),
    };
}
