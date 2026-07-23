import { Types } from "mongoose";
import { connectToDatabase } from "@semantask/db";
import OrganizationPolicyModel, {
    PROMPT_GUARD_MODES,
    type IOrganizationPolicy,
    type PromptGuardMode,
} from "@semantask/db/models/OrganizationPolicy";
import { assertCanManageMembers, assertMembership } from "./organization.service";
import { AuthorizationError } from "./authorization-errors";
import { ValidationError } from "./organization-errors";

export type ResolvedOrganizationPolicy = {
    organizationId: string;
    version: number;
    confidenceThresholds: Record<string, number> | null;
    allowedEmailDomains: string[] | null;
    requireApprovalFor: string[];
    toolDenyList: string[];
    defaultToolGrants: string[];
    promptGuardMode: PromptGuardMode | null;
};

function isValidObjectId(value: string | null | undefined): value is string {
    return Boolean(value && Types.ObjectId.isValid(value));
}

function asStringArray(value: unknown): string[] | null {
    if (value === null || value === undefined) return null;
    if (!Array.isArray(value)) return null;
    return value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0);
}

function normalizeConfidenceThresholds(
    value: Record<string, number> | null | undefined
): Record<string, number> | null {
    if (value === null || value === undefined) {
        return value ?? null;
    }

    const normalized: Record<string, number> = {};
    for (const [key, threshold] of Object.entries(value)) {
        if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
            throw new ValidationError(
                `confidenceThresholds.${key} must be a finite number in [0, 1]`
            );
        }
        normalized[key] = threshold;
    }
    return normalized;
}

export async function getOrganizationPolicy(
    organizationId: string
): Promise<IOrganizationPolicy | null> {
    if (!isValidObjectId(organizationId)) {
        return null;
    }

    await connectToDatabase();
    return OrganizationPolicyModel.findOne({
        organizationId: new Types.ObjectId(organizationId),
    }).lean<IOrganizationPolicy>();
}

export async function resolveOrganizationPolicy(
    organizationId: string | null | undefined
): Promise<ResolvedOrganizationPolicy | null> {
    if (!organizationId) {
        return null;
    }

    const doc = await getOrganizationPolicy(organizationId);
    if (!doc) {
        return {
            organizationId,
            version: 0,
            confidenceThresholds: null,
            allowedEmailDomains: null,
            requireApprovalFor: [],
            toolDenyList: [],
            defaultToolGrants: [],
            promptGuardMode: null,
        };
    }

    return {
        organizationId,
        version: doc.version,
        confidenceThresholds: doc.confidenceThresholds ?? null,
        allowedEmailDomains: doc.allowedEmailDomains?.length
            ? doc.allowedEmailDomains.map((d) => d.toLowerCase())
            : null,
        requireApprovalFor: (doc.requireApprovalFor ?? []).map((t) => t.toLowerCase()),
        toolDenyList: (doc.toolDenyList ?? []).map((t) => t.toLowerCase()),
        defaultToolGrants: (doc.defaultToolGrants ?? []).map((t) => t.toLowerCase()),
        promptGuardMode: doc.promptGuardMode ?? null,
    };
}

export type UpsertOrganizationPolicyInput = {
    organizationId: string;
    actorUserId: string;
    confidenceThresholds?: Record<string, number> | null;
    allowedEmailDomains?: string[] | null;
    requireApprovalFor?: string[] | null;
    toolDenyList?: string[] | null;
    defaultToolGrants?: string[] | null;
    promptGuardMode?: PromptGuardMode | null;
};

export async function upsertOrganizationPolicy(
    input: UpsertOrganizationPolicyInput
): Promise<IOrganizationPolicy> {
    await assertCanManageMembers(input.organizationId, input.actorUserId);

    if (
        input.promptGuardMode != null
        && !PROMPT_GUARD_MODES.includes(input.promptGuardMode)
    ) {
        throw new ValidationError("Invalid promptGuardMode");
    }

    await connectToDatabase();

    const $set: Record<string, unknown> = {};
    if (input.confidenceThresholds !== undefined) {
        $set.confidenceThresholds = normalizeConfidenceThresholds(input.confidenceThresholds);
    }
    if (input.allowedEmailDomains !== undefined) {
        $set.allowedEmailDomains = asStringArray(input.allowedEmailDomains);
    }
    if (input.requireApprovalFor !== undefined) {
        $set.requireApprovalFor = asStringArray(input.requireApprovalFor) ?? [];
    }
    if (input.toolDenyList !== undefined) {
        $set.toolDenyList = asStringArray(input.toolDenyList) ?? [];
    }
    if (input.defaultToolGrants !== undefined) {
        $set.defaultToolGrants = asStringArray(input.defaultToolGrants) ?? [];
    }
    if (input.promptGuardMode !== undefined) {
        $set.promptGuardMode = input.promptGuardMode;
    }

    const updated = await OrganizationPolicyModel.findOneAndUpdate(
        { organizationId: new Types.ObjectId(input.organizationId) },
        {
            $set,
            $inc: { version: 1 },
            $setOnInsert: {
                organizationId: new Types.ObjectId(input.organizationId),
            },
        },
        { upsert: true, new: true }
    ).lean<IOrganizationPolicy>();

    if (!updated) {
        throw new Error("Failed to upsert organization policy");
    }

    return updated;
}

export async function getOrganizationPolicyForViewer(
    organizationId: string,
    actorUserId: string
): Promise<IOrganizationPolicy | null> {
    await assertMembership(organizationId, actorUserId);
    return getOrganizationPolicy(organizationId);
}

export function serializeOrganizationPolicy(doc: IOrganizationPolicy | null, organizationId: string) {
    if (!doc) {
        return {
            organizationId,
            version: 0,
            confidenceThresholds: null,
            allowedEmailDomains: null,
            requireApprovalFor: [],
            toolDenyList: [],
            defaultToolGrants: [],
            promptGuardMode: null,
        };
    }

    return {
        organizationId: doc.organizationId.toString(),
        version: doc.version,
        confidenceThresholds: doc.confidenceThresholds ?? null,
        allowedEmailDomains: doc.allowedEmailDomains ?? null,
        requireApprovalFor: doc.requireApprovalFor ?? [],
        toolDenyList: doc.toolDenyList ?? [],
        defaultToolGrants: doc.defaultToolGrants ?? [],
        promptGuardMode: doc.promptGuardMode ?? null,
        updatedAt: doc.updatedAt?.toISOString?.() ?? null,
    };
}

export { AuthorizationError };
