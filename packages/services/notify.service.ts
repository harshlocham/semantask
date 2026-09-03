import { Types } from "mongoose";
import { connectToDatabase } from "@semantask/db";
import NotifyDedupeModel from "@semantask/db/models/NotifyDedupe";
import { User } from "@semantask/db/models/User";

export type NotifyKind =
    | "task_assigned"
    | "approval_required"
    | "mention"
    | "task_blocked"
    | "task_overdue"
    | "execution_succeeded"
    | "execution_failed";

export type NotifyUserInput = {
    userId: string;
    kind: NotifyKind;
    subject: string;
    text: string;
    html?: string;
    dedupeKey: string;
    conversationId?: string | null;
    entityId?: string;
};

function isValidObjectId(value: string | null | undefined): value is string {
    return Boolean(value && Types.ObjectId.isValid(value));
}

function isDuplicateKeyError(error: unknown): boolean {
    return Boolean(
        error
        && typeof error === "object"
        && "code" in error
        && (error as { code?: number }).code === 11000
    );
}

/** Returns true if this dedupe key is newly claimed (caller should send). */
async function claimDedupeKey(key: string): Promise<boolean> {
    if (!key.trim()) return true;
    await connectToDatabase();
    try {
        await NotifyDedupeModel.create({ key: key.slice(0, 240) });
        return true;
    } catch (error) {
        if (isDuplicateKeyError(error)) return false;
        console.error("notify.dedupe claim failed", error);
        return true;
    }
}

async function releaseDedupeKey(key: string): Promise<void> {
    if (!key.trim()) return;
    try {
        await NotifyDedupeModel.deleteOne({ key: key.slice(0, 240) });
    } catch (error) {
        console.error("notify.dedupe release failed", error);
    }
}

async function resolveUserEmail(userId: string): Promise<{ email: string; username: string } | null> {
    if (!isValidObjectId(userId)) return null;
    await connectToDatabase();
    const user = await User.findById(userId)
        .select({ email: 1, username: 1 })
        .lean<{ email: string; username: string } | null>();
    if (!user?.email) return null;
    return { email: user.email, username: user.username };
}

function resolveFromAddress(): string | undefined {
    return (
        process.env.RESEND_FROM_EMAIL?.trim()
        || process.env.EMAIL_FROM?.trim()
        || process.env.SMTP_USER?.trim()
        || undefined
    );
}

function isSmtpConfigured(): boolean {
    return Boolean(
        process.env.SMTP_HOST?.trim()
        && process.env.SMTP_USER?.trim()
        && process.env.SMTP_PASS?.trim()
        && resolveFromAddress()
    );
}

async function sendViaSmtp(input: {
    to: string;
    subject: string;
    text: string;
    html: string;
    from: string;
}): Promise<"sent" | "failed"> {
    try {
        const nodemailer = await import("nodemailer");
        const port = Number.parseInt(process.env.SMTP_PORT?.trim() || "587", 10);
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST!.trim(),
            port: Number.isFinite(port) ? port : 587,
            secure: port === 465,
            auth: {
                user: process.env.SMTP_USER!.trim(),
                pass: process.env.SMTP_PASS!.trim(),
            },
        });
        await transporter.sendMail({
            from: input.from,
            to: input.to,
            subject: input.subject,
            text: input.text,
            html: input.html,
        });
        return "sent";
    } catch (error) {
        console.error("notify.email smtp error", error);
        return "failed";
    }
}

async function sendEmail(input: {
    to: string;
    subject: string;
    text: string;
    html: string;
}): Promise<"sent" | "skipped" | "failed"> {
    const resendKey = process.env.RESEND_API_KEY?.trim();
    const from = resolveFromAddress();

    if (resendKey && from) {
        try {
            const response = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${resendKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    from,
                    to: [input.to],
                    subject: input.subject,
                    text: input.text,
                    html: input.html,
                }),
            });
            if (!response.ok) {
                console.error("notify.email resend failed", await response.text());
                return "failed";
            }
            return "sent";
        } catch (error) {
            console.error("notify.email resend error", error);
            return "failed";
        }
    }

    if (from && isSmtpConfigured()) {
        return sendViaSmtp({ ...input, from });
    }

    console.info(
        "notify.email skipped (configure RESEND_API_KEY + RESEND_FROM_EMAIL, or SMTP_HOST/USER/PASS)"
    );
    return "skipped";
}

async function pushSocketNotify(input: NotifyUserInput): Promise<void> {
    const base =
        process.env.SOCKET_INTERNAL_URL?.trim()
        || process.env.INTERNAL_SOCKET_URL?.trim();
    if (!base) return;

    try {
        await fetch(`${base.replace(/\/$/, "")}/internal/user-notify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                userId: input.userId,
                payload: {
                    kind: input.kind,
                    subject: input.subject,
                    text: input.text,
                    entityId: input.entityId ?? null,
                    conversationId: input.conversationId ?? null,
                    dedupeKey: input.dedupeKey,
                },
            }),
        });
    } catch (error) {
        console.error("notify.socket failed", error);
    }
}

/** Product notification: Resend or SMTP email when configured + optional socket push. */
export async function notifyUser(input: NotifyUserInput): Promise<void> {
    const dedupeKey = `${input.dedupeKey}:${input.userId}`;
    const claimed = await claimDedupeKey(dedupeKey);
    if (!claimed) return;

    const user = await resolveUserEmail(input.userId);
    if (!user) {
        await releaseDedupeKey(dedupeKey);
        return;
    }

    const html = input.html ?? `<p>${input.text}</p>`;
    const delivery = await sendEmail({
        to: user.email,
        subject: input.subject,
        text: input.text,
        html,
    });
    if (delivery !== "sent") {
        await releaseDedupeKey(dedupeKey);
    }
    await pushSocketNotify(input);
}

export async function notifyUsers(
    userIds: string[],
    input: Omit<NotifyUserInput, "userId">
): Promise<void> {
    const unique = Array.from(new Set(userIds.filter(isValidObjectId)));
    await Promise.all(
        unique.map((userId) =>
            notifyUser({
                ...input,
                userId,
                dedupeKey: input.dedupeKey,
            })
        )
    );
}
