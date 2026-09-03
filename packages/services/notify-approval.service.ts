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
    const managers = await OrganizationMembershipModel.find({
        organizationId: new Types.ObjectId(input.organizationId),
        role: { $in: ["owner", "admin"] },
    })
        .select({ userId: 1 })
        .limit(200)
        .lean<Array<{ userId: { toString(): string } }>>();

    const actorId = input.actorUserId?.toString() ?? null;
    const recipients = managers
        .map((row) => row.userId.toString())
        .filter((id) => id !== actorId);

    if (recipients.length === 0) return;

    const text =
        input.reasonText?.trim()
        || `AI tool execution was requested for "${input.title}" and needs approval.`;
    const html = `<p>${escapeHtml(text)}</p>`;
    const approvalsHref = absoluteApprovalsHref();

    await notifyUsers(recipients, {
        kind: "approval_required",
        subject: `Approval needed: ${input.title}`,
        text: withAbsoluteCtaText(text, approvalsHref, "Open approvals"),
        html: withAbsoluteCta(html, approvalsHref, "Open approvals"),
        dedupeKey: `approval:${input.taskId}:${input.actionId}`,
        conversationId: input.conversationId,
        entityId: input.taskId,
    });
}
