import { Types } from "mongoose";
import { connectToDatabase } from "@semantask/db";
import ToolGrantModel, {
    HIGH_RISK_TOOLS,
    isHighRiskToolName,
    type HighRiskToolName,
    type IToolGrant,
} from "@semantask/db/models/ToolGrant";
import TaskModel from "@semantask/db/models/Task";
import { AuthorizationError } from "./authorization-errors";
import { resolveOrganizationPolicy } from "./organization-policy.service";

export type ToolRbacMode = "off" | "enforce";

export function getToolRbacMode(): ToolRbacMode {
    const raw = (process.env.TASK_TOOL_RBAC || "off").trim().toLowerCase();
    if (raw === "enforce") return "enforce";
    return "off";
}

function isValidObjectId(value: string | null | undefined): value is string {
    return Boolean(value && Types.ObjectId.isValid(value));
}

export async function hasToolGrant(
    userId: string,
    toolName: string,
    conversationId?: string | null,
    organizationId?: string | null
): Promise<boolean> {
    if (!isHighRiskToolName(toolName)) {
        return true;
    }

    if (!isValidObjectId(userId)) {
        return false;
    }

    const orgPolicy = await resolveOrganizationPolicy(organizationId);
    if (orgPolicy?.toolDenyList.includes(toolName.toLowerCase())) {
        return false;
    }
    if (orgPolicy?.defaultToolGrants.includes(toolName.toLowerCase())) {
        return true;
    }

    await connectToDatabase();

    const orClauses: Record<string, unknown>[] = [
        { conversationId: null, organizationId: null },
    ];

    if (isValidObjectId(conversationId)) {
        orClauses.push({
            conversationId: new Types.ObjectId(conversationId),
            organizationId: isValidObjectId(organizationId)
                ? new Types.ObjectId(organizationId)
                : null,
        });
    }

    if (isValidObjectId(organizationId)) {
        orClauses.push({
            conversationId: null,
            organizationId: new Types.ObjectId(organizationId),
        });
    }

    const grant = await ToolGrantModel.findOne({
        userId: new Types.ObjectId(userId),
        toolName,
        revokedAt: null,
        $or: orClauses,
    })
        .select("_id")
        .lean();

    return Boolean(grant);
}

export async function assertToolGrant(
    userId: string,
    toolName: string,
    conversationId?: string | null,
    organizationId?: string | null
): Promise<void> {
    // Org deny list always applies when organizationId is present (even if RBAC is off).
    if (organizationId && isHighRiskToolName(toolName)) {
        const orgPolicy = await resolveOrganizationPolicy(organizationId);
        if (orgPolicy?.toolDenyList.includes(toolName.toLowerCase())) {
            console.warn("tool_grant.deny", {
                event: "tool_grant.deny",
                reason: "org_deny_list",
                userId,
                toolName,
                organizationId,
            });
            throw new AuthorizationError(
                "FORBIDDEN",
                `Tool "${toolName}" is denied by organization policy.`
            );
        }
    }

    if (getToolRbacMode() === "off") {
        return;
    }

    if (!isHighRiskToolName(toolName)) {
        return;
    }

    const allowed = await hasToolGrant(userId, toolName, conversationId, organizationId);
    if (allowed) {
        return;
    }

    console.warn("tool_grant.deny", {
        event: "tool_grant.deny",
        userId,
        toolName,
        conversationId: conversationId ?? null,
        organizationId: organizationId ?? null,
    });

    throw new AuthorizationError(
        "FORBIDDEN",
        `Tool grant required for "${toolName}".`
    );
}

export async function listGrantedToolNames(
    userId: string,
    conversationId?: string | null,
    organizationId?: string | null
): Promise<string[]> {
    const orgPolicy = await resolveOrganizationPolicy(organizationId);
    const denied = new Set(orgPolicy?.toolDenyList ?? []);

    if (getToolRbacMode() === "off") {
        return [...HIGH_RISK_TOOLS].filter((name) => !denied.has(name.toLowerCase()));
    }

    if (!isValidObjectId(userId)) {
        return [];
    }

    const defaults = new Set(orgPolicy?.defaultToolGrants ?? []);

    await connectToDatabase();

    const orClauses: Record<string, unknown>[] = [{ conversationId: null, organizationId: null }];
    if (isValidObjectId(conversationId)) {
        orClauses.push({
            conversationId: new Types.ObjectId(conversationId),
            organizationId: isValidObjectId(organizationId)
                ? new Types.ObjectId(organizationId)
                : null,
        });
    }
    if (isValidObjectId(organizationId)) {
        orClauses.push({
            conversationId: null,
            organizationId: new Types.ObjectId(organizationId),
        });
    }

    const grants = await ToolGrantModel.find({
        userId: new Types.ObjectId(userId),
        revokedAt: null,
        $or: orClauses,
    })
        .select("toolName")
        .lean<{ toolName: HighRiskToolName }[]>();

    const names = new Set<string>([
        ...defaults,
        ...grants.map((grant) => grant.toolName),
    ]);

    return Array.from(names).filter((name) => !denied.has(name.toLowerCase()));
}

export type GrantToolInput = {
    userId: string;
    toolName: HighRiskToolName;
    grantedBy: string;
    conversationId?: string | null;
    organizationId?: string | null;
};

export async function grantTool(input: GrantToolInput): Promise<IToolGrant> {
    if (!isValidObjectId(input.userId) || !isValidObjectId(input.grantedBy)) {
        throw new AuthorizationError("FORBIDDEN", "Invalid user id");
    }

    if (input.conversationId && !isValidObjectId(input.conversationId)) {
        throw new AuthorizationError("FORBIDDEN", "Invalid conversation id");
    }

    if (input.organizationId && !isValidObjectId(input.organizationId)) {
        throw new AuthorizationError("FORBIDDEN", "Invalid organization id");
    }

    await connectToDatabase();

    const conversationId = input.conversationId
        ? new Types.ObjectId(input.conversationId)
        : null;
    const organizationId = input.organizationId
        ? new Types.ObjectId(input.organizationId)
        : null;

    const existing = await ToolGrantModel.findOne({
        userId: new Types.ObjectId(input.userId),
        toolName: input.toolName,
        conversationId,
        organizationId,
        revokedAt: null,
    });

    if (existing) {
        return existing;
    }

    const revoked = await ToolGrantModel.findOne({
        userId: new Types.ObjectId(input.userId),
        toolName: input.toolName,
        conversationId,
        organizationId,
        revokedAt: { $ne: null },
    });

    if (revoked) {
        try {
            revoked.revokedAt = null;
            revoked.grantedBy = new Types.ObjectId(input.grantedBy);
            await revoked.save();
            return revoked;
        } catch (error) {
            const maybeMongo = error as { code?: number };
            if (maybeMongo?.code === 11000) {
                const raced = await ToolGrantModel.findOne({
                    userId: new Types.ObjectId(input.userId),
                    toolName: input.toolName,
                    conversationId,
                    organizationId,
                    revokedAt: null,
                });
                if (raced) {
                    return raced;
                }
            }
            throw error;
        }
    }

    try {
        return await ToolGrantModel.create({
            userId: new Types.ObjectId(input.userId),
            toolName: input.toolName,
            conversationId,
            organizationId,
            grantedBy: new Types.ObjectId(input.grantedBy),
            revokedAt: null,
        });
    } catch (error) {
        const maybeMongo = error as { code?: number };
        if (maybeMongo?.code === 11000) {
            const raced = await ToolGrantModel.findOne({
                userId: new Types.ObjectId(input.userId),
                toolName: input.toolName,
                conversationId,
                organizationId,
                revokedAt: null,
            });
            if (raced) {
                return raced;
            }
        }
        throw error;
    }
}

export async function revokeTool(grantId: string): Promise<IToolGrant | null> {
    if (!isValidObjectId(grantId)) {
        throw new AuthorizationError("NOT_FOUND", "Grant not found");
    }

    await connectToDatabase();

    const grant = await ToolGrantModel.findById(grantId);
    if (!grant) {
        throw new AuthorizationError("NOT_FOUND", "Grant not found");
    }

    if (!grant.revokedAt) {
        grant.revokedAt = new Date();
        await grant.save();
    }

    return grant;
}

export type ListToolGrantsInput = {
    page?: number;
    limit?: number;
    userId?: string;
    toolName?: string;
    includeRevoked?: boolean;
};

export type ToolGrantListItem = {
    id: string;
    userId: string;
    conversationId: string | null;
    organizationId: string | null;
    toolName: string;
    grantedBy: string;
    revokedAt: string | null;
    createdAt: string;
};

export async function listToolGrants(input: ListToolGrantsInput = {}): Promise<{
    grants: ToolGrantListItem[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
    const page = Number.isFinite(input.page) ? Math.max(1, Number(input.page)) : 1;
    const limit = Number.isFinite(input.limit) ? Math.min(100, Math.max(1, Number(input.limit))) : 20;

    await connectToDatabase();

    const query: Record<string, unknown> = {};
    if (!input.includeRevoked) {
        query.revokedAt = null;
    }
    if (isValidObjectId(input.userId)) {
        query.userId = new Types.ObjectId(input.userId);
    }
    if (input.toolName && isHighRiskToolName(input.toolName)) {
        query.toolName = input.toolName;
    }

    const [total, rows] = await Promise.all([
        ToolGrantModel.countDocuments(query),
        ToolGrantModel.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean<IToolGrant[]>(),
    ]);

    return {
        grants: rows.map((row) => ({
            id: row._id.toString(),
            userId: row.userId.toString(),
            conversationId: row.conversationId ? row.conversationId.toString() : null,
            organizationId: row.organizationId ? row.organizationId.toString() : null,
            toolName: row.toolName,
            grantedBy: row.grantedBy.toString(),
            revokedAt: row.revokedAt ? new Date(row.revokedAt).toISOString() : null,
            createdAt: new Date(row.createdAt).toISOString(),
        })),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        },
    };
}

/**
 * Grant all high-risk tools (global scope) to every distinct task creator.
 * Idempotent — skips users who already have active grants.
 */
export async function seedExistingUsersToolGrants(grantedBy: string): Promise<{
    usersConsidered: number;
    grantsCreated: number;
}> {
    if (!isValidObjectId(grantedBy)) {
        throw new AuthorizationError("FORBIDDEN", "Invalid grantedBy");
    }

    await connectToDatabase();

    const creators = await TaskModel.distinct("createdBy");
    const userIds = creators
        .map((id) => id?.toString?.() ?? String(id))
        .filter((id) => isValidObjectId(id));

    let grantsCreated = 0;

    for (const userId of userIds) {
        for (const toolName of HIGH_RISK_TOOLS) {
            const before = await hasToolGrant(userId, toolName, null, null);
            if (before) continue;
            await grantTool({ userId, toolName, grantedBy, conversationId: null, organizationId: null });
            grantsCreated += 1;
        }
    }

    return {
        usersConsidered: userIds.length,
        grantsCreated,
    };
}

export type { HighRiskToolName };
export { HIGH_RISK_TOOLS, isHighRiskToolName };
