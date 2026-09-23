"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WorkSuggestionRecord } from "@semantask/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import useWorkSuggestionStore from "@/store/work-suggestion-store";
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
    const assigneeCount = suggestion.candidates.assigneeCandidates?.length ?? 0;

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

    return (
        <div
            className="mt-2 w-full rounded-xl border border-border bg-card p-3 text-left shadow-[var(--shadow-card)]"
            data-testid="conversation-suggestion-card"
        >
            <p className="text-[11px] font-medium uppercase tracking-wide text-primary">
                AI detected potential work
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">{suggestion.title}</p>
            <p className="mt-1 text-xs text-muted-foreground" data-testid="conversation-suggestion-note">
                {proposed
                    ? "This is a suggestion, not a task yet."
                    : "This suggestion became a coordination task. Tool execution is a separate decision."}
            </p>
            {proposed ? (
                <p className="mt-2 text-sm text-foreground" data-testid="conversation-suggestion-outcome">
                    {suggestionOutcome(suggestion)}
                </p>
            ) : null}

            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                    <dt className="text-muted-foreground">Suggested assignee</dt>
                    <dd className="font-medium text-foreground">
                        {assigneeCount > 0
                            ? `${assigneeCount} suggested`
                            : "Not suggested"}
                    </dd>
                </div>
                <div>
                    <dt className="text-muted-foreground">Due</dt>
                    <dd className="font-medium text-foreground">
                        {formatDue(suggestion.candidates.dueAtCandidate)}
                    </dd>
                </div>
                <div>
                    <dt className="text-muted-foreground">Priority</dt>
                    <dd className="font-medium capitalize text-foreground">
                        {suggestion.candidates.priorityCandidate || "Not suggested"}
                    </dd>
                </div>
                <div>
                    <dt className="text-muted-foreground">Confidence</dt>
                    <dd className="font-medium text-foreground">{suggestionConfidencePercent(suggestion)}%</dd>
                </div>
            </dl>

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
                                value={reason}
                                onChange={(event) => setReason(event.target.value)}
                                placeholder="Required to dismiss"
                                disabled={pending !== null}
                            />
                        </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
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
                    <p className="text-sm font-medium text-foreground">Task created</p>
                    <Link
                        href={taskHref(suggestion.convertedTaskId)}
                        className="text-sm font-medium text-primary underline underline-offset-2"
                        data-testid="conversation-suggestion-task-link"
                    >
                        Open task
                    </Link>
                    {toolLabel ? (
                        <div className="rounded-lg border border-border bg-muted/40 p-2" data-testid="conversation-suggestion-tools">
                            <p className="text-xs text-muted-foreground">
                                AI identified an action that could help complete this task. Allowing it is separate from accepting the suggestion.
                            </p>
                            <p className="mt-1 text-sm font-medium text-foreground">Tool: {toolLabel}</p>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="mt-2"
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
