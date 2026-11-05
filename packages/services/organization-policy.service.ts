import { Types } from "mongoose";
import { connectToDatabase } from "@semantask/db";
import OrganizationPolicyModel, {
    EXECUTION_MODES,
    PROMPT_GUARD_MODES,
    type IOrganizationPolicy,
    type OrganizationExecutionMode,
    type PromptGuardMode,
} from "@semantask/db/models/OrganizationPolicy";
import type { ExecutionMode } from "@semantask/types";
import { assertCanManageMembers, assertMembership, getOrganizationById } from "./organization.service";
import { AuthorizationError } from "./authorization-errors";
import { ValidationError } from "./organization-errors";
import {
    getEffectiveExecutionMode,
    isExecutionModeValue,
} from "./config/execution";

export {
    getEffectiveExecutionMode,
    isExecutionModeEnforce,
    parseDefaultExecutionMode,
    parseGrandfatherAutoTenants,
} from "./config/execution";
export {
    assertAcceptCreatesCoordinationOnly,
    isAcceptCreatesExecutionEnabled,
    isCoordinationBoardEnabled,
    isOrgDashboardEnabled,
    isSuggestionIngressEnabled,
    isWorkInboxUiEnabled,
    shouldBlockExecutionEnqueue,
} from "./config/flags";

const TOOL_AUTONOMY_MODES = ["off", "suggest_only", "require_approval", "auto_execute"] as const;
const POLICY_TOOL_NAMES = ["send_email", "schedule_meeting", "create_github_issue"] as const;

export type ToolAutonomyMode = (typeof TOOL_AUTONOMY_MODES)[number];
export type ToolExecutionModes = Partial<Record<(typeof POLICY_TOOL_NAMES)[number], ToolAutonomyMode>>;

export type ResolvedOrganizationPolicy = {
    organizationId: string;
    version: number;
    confidenceThresholds: Record<string, number> | null;
    allowedEmailDomains: string[] | null;
    requireApprovalFor: string[];
    toolDenyList: string[];
    defaultToolGrants: string[];
    promptGuardMode: PromptGuardMode | null;
    executionMode: ExecutionMode | null;
    toolExecutionModes: ToolExecutionModes | null;
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

function normalizeStoredExecutionMode(
    value: OrganizationExecutionMode | null | undefined
): ExecutionMode | null {
    if (value == null) return null;
    return isExecutionModeValue(value) ? value : null;
}

function isPolicyToolName(value: string): value is (typeof POLICY_TOOL_NAMES)[number] {
    return (POLICY_TOOL_NAMES as readonly string[]).includes(value);
}

function isToolAutonomyMode(value: string): value is ToolAutonomyMode {
    return (TOOL_AUTONOMY_MODES as readonly string[]).includes(value);
}

function normalizeToolExecutionModes(value: unknown): ToolExecutionModes | null {
    if (value == null) return null;
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new ValidationError("toolExecutionModes must be an object");
    }

    const normalized: ToolExecutionModes = {};
    for (const [tool, mode] of Object.entries(value)) {
        const toolName = tool.trim().toLowerCase();
        if (!isPolicyToolName(toolName)) {
            throw new ValidationError(`Unknown tool in toolExecutionModes: ${tool}`);
        }
        if (typeof mode !== "string" || !isToolAutonomyMode(mode)) {
            throw new ValidationError(`Invalid autonomy mode for ${toolName}`);
        }
        normalized[toolName] = mode;
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
            executionMode: null,
            toolExecutionModes: null,
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
        executionMode: normalizeStoredExecutionMode(doc.executionMode),
        toolExecutionModes: normalizeToolExecutionModes(doc.toolExecutionModes),
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
    executionMode?: ExecutionMode | null;
    toolExecutionModes?: ToolExecutionModes | null;
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

    if (
        input.executionMode != null
        && !(EXECUTION_MODES as readonly string[]).includes(input.executionMode)
    ) {
        throw new ValidationError("Invalid executionMode");
    }

    await connectToDatabase();

    const organizationObjectId = new Types.ObjectId(input.organizationId);
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const previous = await OrganizationPolicyModel.findOne({
            organizationId: organizationObjectId,
        }).lean<IOrganizationPolicy>();
        const previousMode = normalizeStoredExecutionMode(previous?.executionMode);

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
        if (input.toolExecutionModes !== undefined) {
            $set.toolExecutionModes = normalizeToolExecutionModes(input.toolExecutionModes);
        }

        let executionModeChanged = false;
        if (input.executionMode !== undefined) {
            $set.executionMode = input.executionMode;
            if (previousMode !== input.executionMode) {
                executionModeChanged = true;
                $set.executionModeUpdatedAt = new Date();
                if (isValidObjectId(input.actorUserId)) {
                    $set.executionModeUpdatedBy = new Types.ObjectId(input.actorUserId);
                }
            }
        }

        const filter: Record<string, unknown> = {
            organizationId: organizationObjectId,
        };
        if (previous) {
            filter.version = previous.version;
        }

        try {
            const updated = await OrganizationPolicyModel.findOneAndUpdate(
                filter,
                {
                    $set,
                    $inc: { version: 1 },
                    $setOnInsert: {
                        organizationId: organizationObjectId,
                    },
                },
                {
                    upsert: !previous,
                    new: true,
                }
            ).lean<IOrganizationPolicy>();

            if (!updated) {
                // Version compare-and-swap miss — another writer won; retry.
                continue;
            }

            if (executionModeChanged) {
                console.info(JSON.stringify({
                    event: "policy.execution_mode.changed",
                    organizationId: input.organizationId,
                    actorUserId: input.actorUserId,
                    previousMode,
                    executionMode: normalizeStoredExecutionMode(updated.executionMode)
                        ?? input.executionMode,
                    version: updated.version,
                }));
            }

            return updated;
        } catch (error) {
            const maybeMongo = error as { code?: number };
            if (maybeMongo?.code === 11000) {
                continue;
            }
            throw error;
        }
    }

    throw new Error("Failed to upsert organization policy after concurrent retries");
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
            executionMode: null,
            toolExecutionModes: null,
            effectiveExecutionMode: getEffectiveExecutionMode({ organizationId, executionMode: null }),
        };
    }

    const executionMode = normalizeStoredExecutionMode(doc.executionMode);

    return {
        organizationId: doc.organizationId.toString(),
        version: doc.version,
        confidenceThresholds: doc.confidenceThresholds ?? null,
        allowedEmailDomains: doc.allowedEmailDomains ?? null,
        requireApprovalFor: doc.requireApprovalFor ?? [],
        toolDenyList: doc.toolDenyList ?? [],
        defaultToolGrants: doc.defaultToolGrants ?? [],
        promptGuardMode: doc.promptGuardMode ?? null,
        toolExecutionModes: normalizeToolExecutionModes(doc.toolExecutionModes),
        executionMode,
        effectiveExecutionMode: getEffectiveExecutionMode({
            organizationId: doc.organizationId.toString(),
            executionMode,
        }),
        executionModeUpdatedAt: doc.executionModeUpdatedAt?.toISOString?.() ?? null,
        updatedAt: doc.updatedAt?.toISOString?.() ?? null,
    };
}

export type GrandfatherApplyStatus =
    | "applied"
    | "would_apply"
    | "already_auto_execute"
    | "already_explicit"
    | "invalid_id"
    | "missing_org";

export type GrandfatherApplyRow = {
    organizationId: string;
    status: GrandfatherApplyStatus;
    previousMode: ExecutionMode | null;
};

export type GrandfatherApplyResult = {
    ok: boolean;
    dryRun: boolean;
    rows: GrandfatherApplyRow[];
};

function uniqueOrganizationIds(ids: Iterable<string>): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const raw of ids) {
        const organizationId = raw.trim();
        if (!organizationId || seen.has(organizationId)) {
            continue;
        }
        seen.add(organizationId);
        unique.push(organizationId);
    }
    return unique;
}

function grandfatherSkipStatus(
    mode: ExecutionMode
): Extract<GrandfatherApplyStatus, "already_auto_execute" | "already_explicit"> {
    return mode === "auto_execute" ? "already_auto_execute" : "already_explicit";
}

async function persistGrandfatherAutoExecute(
    organizationId: string,
    previousMode: ExecutionMode | null
): Promise<Extract<GrandfatherApplyStatus, "applied" | "already_auto_execute" | "already_explicit">> {
    const organizationObjectId = new Types.ObjectId(organizationId);
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const previous = await OrganizationPolicyModel.findOne({
            organizationId: organizationObjectId,
        }).lean<IOrganizationPolicy>();
        const currentMode = normalizeStoredExecutionMode(previous?.executionMode);
        if (currentMode != null) {
            return grandfatherSkipStatus(currentMode);
        }

        const filter: Record<string, unknown> = {
            organizationId: organizationObjectId,
            executionMode: null,
        };
        if (previous) {
            filter.version = previous.version;
        }

        try {
            const updated = await OrganizationPolicyModel.findOneAndUpdate(
                filter,
                {
                    $set: {
                        executionMode: "auto_execute",
                        executionModeUpdatedAt: new Date(),
                    },
                    $inc: { version: 1 },
                    $setOnInsert: {
                        organizationId: organizationObjectId,
                    },
                },
                {
                    upsert: !previous,
                    new: true,
                }
            ).lean<IOrganizationPolicy>();

            if (!updated) {
                continue;
            }

            console.info(JSON.stringify({
                event: "policy.execution_mode.changed",
                organizationId,
                actorUserId: "system:grandfather-auto-execute",
                previousMode,
                executionMode: "auto_execute",
                version: updated.version,
            }));
            return "applied";
        } catch (error) {
            const maybeMongo = error as { code?: number };
            if (maybeMongo?.code === 11000) {
                continue;
            }
            throw error;
        }
    }

    throw new Error(`Failed to persist grandfather auto_execute for ${organizationId}`);
}

/**
 * Ops-only. No membership check. Writes `executionMode: auto_execute` so listed
 * orgs keep today's grandfather behavior after `GRANDFATHER_AUTO_TENANTS` is cleared.
 * The env list is a bootstrap for unset policy only; an explicit org field wins.
 * Does not delete the env parser. Fails closed (no writes) if any id is invalid
 * or the organization is missing.
 */
export async function applyGrandfatherAutoExecute(args: {
    organizationIds: Iterable<string>;
    dryRun?: boolean;
}): Promise<GrandfatherApplyResult> {
    const dryRun = Boolean(args.dryRun);
    const organizationIds = uniqueOrganizationIds(args.organizationIds);
    const rows: GrandfatherApplyRow[] = [];

    await connectToDatabase();

    for (const organizationId of organizationIds) {
        if (!isValidObjectId(organizationId)) {
            rows.push({ organizationId, status: "invalid_id", previousMode: null });
            continue;
        }

        const organization = await getOrganizationById(organizationId);
        if (!organization) {
            rows.push({ organizationId, status: "missing_org", previousMode: null });
            continue;
        }

        const policy = await getOrganizationPolicy(organizationId);
        const previousMode = normalizeStoredExecutionMode(policy?.executionMode);
        if (previousMode != null) {
            rows.push({
                organizationId,
                status: grandfatherSkipStatus(previousMode),
                previousMode,
            });
            continue;
        }

        rows.push({
            organizationId,
            status: "would_apply",
            previousMode,
        });
    }

    const ok = rows.every((row) => (
        row.status !== "invalid_id" && row.status !== "missing_org"
    ));
    if (!ok || dryRun) {
        return { ok, dryRun, rows };
    }

    for (const row of rows) {
        if (row.status !== "would_apply") {
            continue;
        }
        row.status = await persistGrandfatherAutoExecute(row.organizationId, row.previousMode);
    }

    return { ok: true, dryRun: false, rows };
}

export { AuthorizationError };
