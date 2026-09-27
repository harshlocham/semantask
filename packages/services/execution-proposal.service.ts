import { Types } from "mongoose";
import type { SuggestedWorkTool } from "@semantask/types";
import { connectToDatabase } from "@semantask/db";
import MessageModel from "@semantask/db/models/Message";
import type { ITask } from "@semantask/db/models/Task";
import type { ITaskAction } from "@semantask/db/models/TaskAction";
import type { IWorkSuggestion } from "@semantask/db/models/WorkSuggestion";
import {
    buildTaskActionIdempotencyKey,
    createTaskAction,
} from "./repositories/task.repo";

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export type DraftExecutionProposal = {
    tool: SuggestedWorkTool;
    parameters: Record<string, unknown>;
    paramsComplete: boolean;
    summary: string;
    reason: string;
};

function isValidObjectId(value: string | null | undefined): value is string {
    return Boolean(value && Types.ObjectId.isValid(value));
}

function extractEmails(text: string): string[] {
    return Array.from(new Set((text.match(EMAIL_RE) ?? []).map((entry) => entry.toLowerCase())));
}

function extractRecipientNoun(text: string): string | null {
    const match = text.match(/\bto\s+(?:the\s+)?([a-zA-Z][a-zA-Z\s-]{1,60}?)(?:\s+by\b|[.,]|$)/i);
    if (!match?.[1]) return null;
    const noun = match[1].trim().replace(/\s+/g, " ");
    if (noun.length < 2) return null;
    return noun;
}

export function draftExecutionParameters(input: {
    tool: SuggestedWorkTool;
    title: string;
    outcome: string;
    sourceContent: string;
}): { parameters: Record<string, unknown>; paramsComplete: boolean } {
    if (input.tool === "send_email") {
        const emails = extractEmails(input.sourceContent);
        const noun = emails.length === 0 ? extractRecipientNoun(input.sourceContent) : null;
        const to = emails.length > 0 ? emails : (noun ? [noun] : []);
        return {
            parameters: {
                to,
                subject: input.title.slice(0, 200),
                body: input.outcome || input.title,
            },
            paramsComplete: emails.length > 0,
        };
    }

    if (input.tool === "create_github_issue") {
        return {
            parameters: {
                title: input.title,
                body: input.outcome || input.title,
            },
            paramsComplete: Boolean(input.title.trim()),
        };
    }

    if (input.tool === "schedule_meeting") {
        return {
            parameters: {
                summary: input.title,
                notes: input.outcome || input.title,
            },
            paramsComplete: false,
        };
    }

    return { parameters: {}, paramsComplete: false };
}

export async function proposeExecutionFromSuggestion(input: {
    task: ITask;
    suggestion: IWorkSuggestion;
    actorUserId: string;
}): Promise<{ action: ITaskAction | null; created: boolean }> {
    const tool = input.suggestion.suggestedTool ?? null;
    if (!tool) {
        return { action: null, created: false };
    }

    await connectToDatabase();

    const message = isValidObjectId(input.suggestion.messageId.toString())
        ? await MessageModel.findById(input.suggestion.messageId).select("content").lean<{ content?: string } | null>()
        : null;
    const sourceContent = typeof message?.content === "string" ? message.content : input.suggestion.summary;
    const outcome = input.suggestion.requestedOutcome || input.suggestion.summary || input.suggestion.title;
    const drafted = draftExecutionParameters({
        tool,
        title: input.suggestion.title,
        outcome,
        sourceContent,
    });

    const policy = input.suggestion.executionPolicy ?? "approval_required";
    const reason = policy === "prohibited"
        ? `Organization policy prohibits ${tool}.`
        : `Organization policy requires approval for ${tool}.`;

    const idempotencyKey = buildTaskActionIdempotencyKey(
        input.task._id.toString(),
        `proposal:${tool}`,
        input.suggestion._id.toString()
    );

    try {
        const action = await createTaskAction({
            taskId: input.task._id.toString(),
            conversationId: input.task.conversationId.toString(),
            actorType: "user",
            actorId: input.actorUserId,
            actionType: tool,
            toolName: tool,
            messageId: input.suggestion.messageId.toString(),
            parameters: drafted.parameters,
            executionState: policy === "prohibited" ? "blocked" : "approval_pending",
            summary: `Proposed ${tool.replace(/_/g, " ")} for “${input.suggestion.title}”.`,
            error: policy === "prohibited"
                ? reason
                : drafted.paramsComplete
                    ? null
                    : "Recipient or parameters are incomplete.",
            patch: {
                before: null,
                after: {
                    source: "suggestion.accept.proposal",
                    executionPolicy: policy,
                    paramsComplete: drafted.paramsComplete,
                    policyDecision: {
                        outcome: policy === "prohibited" ? "blocked" : "approval_required",
                        reasons: [reason],
                    },
                },
            },
            reason,
            idempotencyKey,
        });

        const organizationId = input.task.organizationId?.toString?.() ?? null;
        if (
            organizationId
            && action.executionState === "approval_pending"
        ) {
            void (async () => {
                try {
                    const { notifyApprovalRequired } = await import("./notify-approval.service");
                    await notifyApprovalRequired({
                        organizationId,
                        taskId: input.task._id.toString(),
                        actionId: action._id.toString(),
                        title: input.task.title,
                        conversationId: input.task.conversationId.toString(),
                        actorUserId: input.actorUserId,
                        reasonText: `Tool “${tool.replace(/_/g, " ")}” for "${input.task.title}" needs approval.`,
                    });
                } catch (error) {
                    console.error("proposal approval notify failed", error);
                }
            })();
        }

        return { action, created: true };
    } catch (error) {
        const code = (error as { code?: number })?.code;
        if (code === 11000) {
            const { default: TaskActionModel } = await import("@semantask/db/models/TaskAction");
            const existing = await TaskActionModel.findOne({ idempotencyKey }).exec();
            return { action: existing, created: false };
        }
        throw error;
    }
}
