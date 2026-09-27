import { Types } from "mongoose";
import { connectToDatabase } from "@semantask/db";
import OrganizationMembershipModel from "@semantask/db/models/OrganizationMembership";
import { escapeHtml } from "./html-escape";
import {
    absoluteApprovalsHref,
    withAbsoluteCta,
    withAbsoluteCtaText,
} from "./notify-links";
import { notifyUsers } from "./notify.service";

export type NotifyApprovalRequiredInput = {
    organizationId: string;
    taskId: string;
    actionId: string;
    title: string;
    conversationId: string;
    actorUserId?: string | null;
    /** Override default copy when the trigger is not an explicit AI request. */
    reasonText?: string;
};

function isValidObjectId(value: string | null | undefined): value is string {
    return Boolean(value && Types.ObjectId.isValid(value));
}

/** Owner/admin memberships fetched and notified per page. */
export const APPROVAL_NOTIFY_PAGE_SIZE = 200;

type ManagerMembershipRow = {
    _id: { toString(): string };
    userId: { toString(): string };
};

async function findManagerPage(
    organizationId: string,
    afterId: string | null
): Promise<ManagerMembershipRow[]> {
    const filter: Record<string, unknown> = {
        organizationId: new Types.ObjectId(organizationId),
        role: { $in: ["owner", "admin"] },
    };
    if (afterId) {
        filter._id = { $gt: new Types.ObjectId(afterId) };
    }

    return OrganizationMembershipModel.find(filter)
        .select({ userId: 1 })
        .sort({ _id: 1 })
        .limit(APPROVAL_NOTIFY_PAGE_SIZE)
        .lean<ManagerMembershipRow[]>();
}

/**
 * Notify org owner/admin members that a tool action needs approval.
 * Excludes the actor. Safe to fire-and-forget from callers.
 */
export async function notifyApprovalRequired(input: NotifyApprovalRequiredInput): Promise<void> {
    if (
        !isValidObjectId(input.organizationId)
        || !isValidObjectId(input.taskId)
        || !isValidObjectId(input.actionId)
    ) {
        return;
    }

    await connectToDatabase();

    const actorId = input.actorUserId?.toString() ?? null;
    const text =
        input.reasonText?.trim()
        || `AI tool execution was requested for "${input.title}" and needs approval.`;
    const html = `<p>${escapeHtml(text)}</p>`;
    const approvalsHref = absoluteApprovalsHref();
    const payload = {
        kind: "approval_required" as const,
        subject: `Approval needed: ${input.title}`,
        text: withAbsoluteCtaText(text, approvalsHref, "Open approvals"),
        html: withAbsoluteCta(html, approvalsHref, "Open approvals"),
        dedupeKey: `approval:${input.taskId}:${input.actionId}`,
        conversationId: input.conversationId,
        entityId: input.taskId,
    };

    let afterId: string | null = null;
    for (;;) {
        const page = await findManagerPage(input.organizationId, afterId);
        if (page.length === 0) break;

        const recipients = page
            .map((row) => row.userId.toString())
            .filter((id) => id !== actorId);
        if (recipients.length > 0) {
            await notifyUsers(recipients, payload);
        }

        if (page.length < APPROVAL_NOTIFY_PAGE_SIZE) break;
        afterId = page[page.length - 1]._id.toString();
    }
}
