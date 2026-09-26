"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import type { WorkSuggestionRecord } from "@semantask/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import useChatStore from "@/store/chat-store";
import useWorkSuggestionStore from "@/store/work-suggestion-store";
import { PriorityBadge } from "@/components/work-suggestions/priority-badge";
import {
    acceptWorkSuggestionApi,
    dismissWorkSuggestionApi,
    requestTaskExecutionApi,
} from "@/lib/utils/api";
import { taskHref } from "@/lib/work-links";
import {
    suggestionConfidencePercent,
    suggestionOutcome,
    suggestionToolLabel,
} from "@/lib/work-suggestions/trust";

function formatDue(iso: string | null | undefined) {
    if (!iso) return "Not suggested";
    const value = new Date(iso);
    if (Number.isNaN(value.getTime())) return "Not suggested";
    return value.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
    });
}

export function ConversationSuggestionCard({
    suggestion,
}: {
    suggestion: WorkSuggestionRecord;
}) {
    const router = useRouter();
    const applySuggestion = useWorkSuggestionStore((s) => s.applySuggestion);
    const [reason, setReason] = useState("");
    const [pending, setPending] = useState<"accept" | "dismiss" | "tools" | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [dismissOpen, setDismissOpen] = useState(false);

    const proposed = suggestion.status === "proposed";
    const converted = suggestion.status === "converted" && Boolean(suggestion.convertedTaskId);
    const toolLabel = suggestionToolLabel(suggestion);
    const assigneeIds = suggestion.candidates.assigneeCandidates ?? [];
    const assigneeCount = assigneeIds.length;
    const participants = useChatStore((s) => s.selectedConversation?.participants);
    const assigneeNames = assigneeIds
        .map((id) => participants?.find((member) => String(member._id) === String(id))?.username)
        .filter((name): name is string => Boolean(name));

    async function accept() {
        setPending("accept");
        setError(null);
        try {
            const result = await acceptWorkSuggestionApi(suggestion._id);
            applySuggestion(suggestion.conversationId, result.suggestion);
        } catch (acceptError) {
            setError(acceptError instanceof Error ? acceptError.message : "Accept failed");
        } finally {
            setPending(null);
        }
    }

    async function dismiss() {
        const trimmed = reason.trim();
        if (!trimmed) return;
        setPending("dismiss");
        setError(null);
        try {
            const result = await dismissWorkSuggestionApi(suggestion._id, trimmed);
            applySuggestion(suggestion.conversationId, result);
        } catch (dismissError) {
            setError(dismissError instanceof Error ? dismissError.message : "Dismiss failed");
        } finally {
            setPending(null);
        }
    }

    async function reviewAction() {
        if (!suggestion.convertedTaskId) return;
        setPending("tools");
        setError(null);
        try {
            await requestTaskExecutionApi(suggestion.convertedTaskId, {
                reason: "Review action from the conversation suggestion card",
            });
            router.push("/inbox/approvals");
        } catch (toolsError) {
            setError(toolsError instanceof Error ? toolsError.message : "Could not open execution approval");
            setPending(null);
        }
    }

    const priority = suggestion.candidates.priorityCandidate;

    return (
        <div
            className="mt-2 w-full max-w-md rounded-xl border border-border bg-card p-3 text-left shadow-[var(--shadow-card)]"
            data-testid="conversation-suggestion-card"
        >
            <div className="flex items-center justify-between gap-2">
                <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary">
                    <Sparkles aria-hidden="true" className="h-3 w-3" />
                    AI detected potential work
                </p>
                <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                    {proposed ? "Suggested" : "Task created"}
                </span>
            </div>
            <p className="mt-1.5 text-sm font-semibold text-foreground">{suggestion.title}</p>
            {proposed ? (
                <>
                    <p className="mt-0.5 text-xs text-muted-foreground" data-testid="conversation-suggestion-outcome">
                        {suggestionOutcome(suggestion)}
                    </p>
                    <p className="sr-only" data-testid="conversation-suggestion-note">
                        This is a suggestion, not a task yet.
                    </p>
                </>
            ) : (
                <p className="mt-0.5 text-xs text-muted-foreground" data-testid="conversation-suggestion-note">
                    This suggestion became a coordination task. Tool execution is a separate decision.
                </p>
            )}

            {proposed ? (
                <dl className="mt-2.5 grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-xs">
                    <dt className="text-muted-foreground">Assignee</dt>
                    <dd className="truncate font-medium text-foreground">
                        {assigneeNames.length > 0
                            ? assigneeNames.join(", ")
                            : assigneeCount > 0
                                ? `${assigneeCount} suggested`
                                : "Not suggested"}
                    </dd>
                    <dt className="text-muted-foreground">Due date</dt>
                    <dd className="font-medium text-foreground">
                        {formatDue(suggestion.candidates.dueAtCandidate)}
                    </dd>
                    <dt className="text-muted-foreground">Priority</dt>
                    <dd>
                        {priority ? (
                            <PriorityBadge priority={priority} />
                        ) : (
                            <span className="font-medium text-foreground">Not suggested</span>
                        )}
                    </dd>
                    <dt className="text-muted-foreground">Confidence</dt>
                    <dd className="font-medium text-foreground">{suggestionConfidencePercent(suggestion)}%</dd>
                </dl>
            ) : null}

            {proposed ? (
                <div className="mt-3 space-y-2">
                    {dismissOpen ? (
                        <div className="space-y-1">
                            <Label htmlFor={`dismiss-${suggestion._id}`} className="text-xs">
                                Dismiss reason
                            </Label>
                            <Input
                                id={`dismiss-${suggestion._id}`}
                                data-testid="conversation-suggestion-dismiss-reason"
                                className="h-8 text-[13px]"
                                value={reason}
                                onChange={(event) => setReason(event.target.value)}
                                placeholder="Required to dismiss"
                                disabled={pending !== null}
                            />
                        </div>
                    ) : null}
                    <div className="grid grid-cols-2 gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8"
                            data-testid="conversation-suggestion-dismiss"
                            disabled={pending !== null || (dismissOpen && !reason.trim())}
                            onClick={() => {
                                if (!dismissOpen) {
                                    setDismissOpen(true);
                                    return;
                                }
                                void dismiss();
                            }}
                        >
                            Dismiss
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            className="h-8"
                            data-testid="conversation-suggestion-accept"
                            disabled={pending !== null}
                            onClick={() => void accept()}
                        >
                            {pending === "accept" ? "Accepting…" : "Review & approve"}
                        </Button>
                    </div>
                </div>
            ) : null}

            {converted && suggestion.convertedTaskId ? (
                <div className="mt-3 space-y-2" data-testid="conversation-suggestion-task">
                    <Button asChild size="sm" variant="outline" className="h-8">
                        <Link
                            href={taskHref(suggestion.convertedTaskId)}
                            data-testid="conversation-suggestion-task-link"
                        >
                            Open task
                        </Link>
                    </Button>
                    {toolLabel ? (
                        <div className="rounded-lg border border-primary/15 bg-primary/5 p-2.5" data-testid="conversation-suggestion-tools">
                            <p className="text-[11px] font-medium text-primary">AI identified an action</p>
                            <p className="mt-1 text-sm font-medium text-foreground">{toolLabel}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                Allowing it is separate from accepting the suggestion. No tools run automatically.
                            </p>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="mt-2 h-8 w-full bg-background"
                                data-testid="conversation-suggestion-review-action"
                                disabled={pending !== null}
                                onClick={() => void reviewAction()}
                            >
                                Review action
                            </Button>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {error ? (
                <p className="mt-2 text-xs text-destructive" data-testid="conversation-suggestion-error">
                    {error}
                </p>
            ) : null}
        </div>
    );
}
