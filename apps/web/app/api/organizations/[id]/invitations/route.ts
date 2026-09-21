import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/Db/db";
import { requireAuthUser } from "@/lib/utils/auth/requireAuthUser";
import { getAppUrl } from "@/lib/config/app";
import { isResendConfigured, sendTransactionalEmail } from "@/lib/utils/send-email";
import {
    createOrganizationInvitation,
    listOrganizationInvitations,
    resendOrganizationInvitation,
    revokeOrganizationInvitation,
} from "@semantask/services/organization-invite.service";
import { AuthorizationError } from "@semantask/services/authorization.service";
import {
    ConflictError,
    organizationApiErrorStatus,
} from "@semantask/services/organization-errors";
import { OrgQuotaExceededError } from "@semantask/services/organization-quota.service";
import { escapeHtml } from "@semantask/services/html-escape";
import type { OrganizationInvitationRole } from "@semantask/db/models/OrganizationInvitation";

type RouteContext = { params: Promise<{ id: string }> };

function inviteUrl(token: string): string {
    const base = getAppUrl()?.replace(/\/$/, "") || "http://localhost:3000";
    return `${base}/invites/${token}`;
}

export async function GET(_req: Request, context: RouteContext) {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    const { id } = await context.params;
    try {
        await connectToDatabase();
        const invitations = await listOrganizationInvitations(id, guard.user.id);
        return NextResponse.json({
            success: true,
            data: invitations.map(({ token: _token, ...rest }) => rest),
        });
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: error.code === "NOT_FOUND" ? 404 : 403 }
            );
        }
        console.error("GET /api/organizations/[id]/invitations error", error);
        return NextResponse.json(
            { success: false, error: "Failed to list invitations" },
            { status: organizationApiErrorStatus(error) }
        );
    }
}

export async function POST(req: Request, context: RouteContext) {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    const { id } = await context.params;
    try {
        await connectToDatabase();
        const body = (await req.json()) as { email?: string; role?: OrganizationInvitationRole };
        if (!body.email?.trim()) {
            return NextResponse.json(
                { success: false, error: "email is required" },
                { status: 400 }
            );
        }

        const invitation = await createOrganizationInvitation({
            organizationId: id,
            actorUserId: guard.user.id,
            email: body.email,
            role: body.role,
        });

        const link = inviteUrl(invitation.token);
        let emailSent = false;
        if (isResendConfigured()) {
            try {
                await sendTransactionalEmail({
                    to: invitation.email,
                    subject: `Join ${invitation.organizationName} on Semantask`,
                    text: `You are invited to join ${invitation.organizationName} on Semantask.\n\nAccept the invitation:\n${link}\n\nThis link expires on ${new Date(invitation.expiresAt).toLocaleString()}.`,
                    html: `<p>You are invited to join <b>${escapeHtml(invitation.organizationName)}</b> on Semantask.</p><p><a href="${link}">Accept invitation</a></p><p>This link expires on ${new Date(invitation.expiresAt).toLocaleString()}.</p>`,
                });
                emailSent = true;
            } catch (mailError) {
                console.error("invite email send failed", mailError);
            }
        }

        const { token: _token, ...publicInvite } = invitation;
        return NextResponse.json(
            {
                success: true,
                data: {
                    ...publicInvite,
                    emailSent,
                    inviteUrl: emailSent ? undefined : link,
                },
            },
            { status: 201 }
        );
    } catch (error) {
        if (error instanceof OrgQuotaExceededError) {
            return NextResponse.json(
                { success: false, error: error.message, code: "ORG_QUOTA_EXCEEDED" },
                { status: 409 }
            );
        }
        if (error instanceof ConflictError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: 409 }
            );
        }
        if (error instanceof AuthorizationError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: error.code === "NOT_FOUND" ? 404 : 403 }
            );
        }
        console.error("POST /api/organizations/[id]/invitations error", error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : "Failed to create invitation",
            },
            { status: organizationApiErrorStatus(error) }
        );
    }
}

export async function DELETE(req: Request, context: RouteContext) {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    const { id } = await context.params;
    try {
        await connectToDatabase();
        const body = (await req.json()) as { invitationId?: string };
        if (!body.invitationId) {
            return NextResponse.json(
                { success: false, error: "invitationId is required" },
                { status: 400 }
            );
        }
        await revokeOrganizationInvitation({
            organizationId: id,
            actorUserId: guard.user.id,
            invitationId: body.invitationId,
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: error.code === "NOT_FOUND" ? 404 : 403 }
            );
        }
        console.error("DELETE /api/organizations/[id]/invitations error", error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : "Failed to revoke invitation",
            },
            { status: organizationApiErrorStatus(error) }
        );
    }
}

export async function PATCH(req: Request, context: RouteContext) {
    const guard = await requireAuthUser();
    if (guard.response) {
        return guard.response;
    }

    const { id } = await context.params;
    try {
        await connectToDatabase();
        const body = (await req.json()) as { invitationId?: string };
        if (!body.invitationId) {
            return NextResponse.json(
                { success: false, error: "invitationId is required" },
                { status: 400 }
            );
        }

        const invitation = await resendOrganizationInvitation({
            organizationId: id,
            actorUserId: guard.user.id,
            invitationId: body.invitationId,
        });

        const link = inviteUrl(invitation.token);
        let emailSent = false;
        if (isResendConfigured()) {
            try {
                await sendTransactionalEmail({
                    to: invitation.email,
                    subject: `You're invited to ${invitation.organizationName}`,
                    text: `Join ${invitation.organizationName}: ${link}`,
                    html: `<p>Join <b>${escapeHtml(invitation.organizationName)}</b>: <a href="${link}">${link}</a></p>`,
                });
                emailSent = true;
            } catch (mailError) {
                console.error("invite resend email failed", mailError);
            }
        }

        const { token: _token, ...rest } = invitation;
        return NextResponse.json({
            success: true,
            data: { ...rest, emailSent, inviteUrl: emailSent ? undefined : link },
        });
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: error.code === "NOT_FOUND" ? 404 : 403 }
            );
        }
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : "Failed to resend invitation",
            },
            { status: organizationApiErrorStatus(error) }
        );
    }
}
