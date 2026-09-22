"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TaskPriority, WorkSuggestionRecord } from "@semantask/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { conversationMessageHref, taskHref } from "@/lib/work-links";
import { APP_HOME } from "@/lib/routes";
import { SuggestionTrustPanel } from "@/components/work-suggestions/suggestion-trust";
import { suggestionOutcome } from "@/lib/work-suggestions/trust";
import {
    WorkInboxTriage,
    type OrgMemberOption,
} from "@/components/work-suggestions/work-inbox-triage";

export type WorkSuggestionDetailViewProps = {
    loading: boolean;
    errorStatus: number | null;
    errorMessage: string | null;
    suggestion: WorkSuggestionRecord | null;
    organizationId?: string | null;
    members?: OrgMemberOption[];
    currentUserId?: string | null;
    displayedOwners?: string[];
    actionError?: string | null;
    actionPending?: boolean;
    onAccept?: (input: {
        assignees?: string[];
        dueAt?: string | null;
        priority?: TaskPriority;
    }) => void | Promise<void>;
    onDismiss?: (reason: string) => void | Promise<void>;
    onAssign?: (input: {
        assignees?: string[];
        dueAt?: string | null;
        priority?: TaskPriority;
    }) => void | Promise<void>;
    onAllowAiTools?: () => void | Promise<void>;
};

function formatTimestamp(iso: string) {
    const value = new Date(iso);
    if (Number.isNaN(value.getTime())) return "-";
    return value.toLocaleString();
}

export function WorkSuggestionDetailView({
    loading,
    errorStatus,
    errorMessage,
    suggestion,
    organizationId = null,
    members = [],
    currentUserId = null,
    displayedOwners,
    actionError = null,
    actionPending = false,
    onAccept,
    onDismiss,
    onAssign,
    onAllowAiTools,
}: WorkSuggestionDetailViewProps) {
    const [dueAtInput, setDueAtInput] = useState("");
    const [priorityInput, setPriorityInput] = useState<TaskPriority | "">("");
    const owners = useMemo(() => {
        if (displayedOwners) return displayedOwners;
        if (suggestion?.status === "proposed") return suggestion.candidates.assigneeCandidates ?? [];
        return [];
    }, [displayedOwners, suggestion?.status, suggestion?.candidates.assigneeCandidates]);

    if (loading) {
        return (
            <div className="mx-auto max-w-2xl space-y-4 p-6" data-testid="work-suggestion-loading">
                <p className="text-sm text-muted-foreground">Loading suggestion…</p>
            </div>
        );
    }

    if (errorStatus === 401 || errorStatus === 403) {
        return (
            <div className="mx-auto max-w-2xl space-y-4 p-6" data-testid="work-suggestion-forbidden">
                <h1 className="text-2xl font-bold">Unable to view suggestion</h1>
                <p className="text-sm text-muted-foreground">
                    {errorMessage || "You do not have access to this work suggestion."}
                </p>
                <Button asChild variant="outline">
                    <Link href={APP_HOME}>Back to chat</Link>
                </Button>
            </div>
        );
    }

    if (errorStatus === 404) {
        return (
            <div className="mx-auto max-w-2xl space-y-4 p-6" data-testid="work-suggestion-not-found">
                <h1 className="text-2xl font-bold">Suggestion not found</h1>
                <p className="text-sm text-muted-foreground">
                    {errorMessage || "This work suggestion does not exist or is no longer available."}
                </p>
                <Button asChild variant="outline">
                    <Link href={APP_HOME}>Back to chat</Link>
                </Button>
            </div>
        );
    }

    if (errorStatus != null) {
        return (
            <div className="mx-auto max-w-2xl space-y-4 p-6" data-testid="work-suggestion-error">
                <h1 className="text-2xl font-bold">Unable to load suggestion</h1>
                <p className="text-sm text-muted-foreground">
                    {errorMessage || "Something went wrong while loading this work suggestion."}
                </p>
                <Button asChild variant="outline">
                    <Link href={APP_HOME}>Back to chat</Link>
                </Button>
            </div>
        );
    }

    if (!suggestion) {
        return (
            <div className="mx-auto max-w-2xl space-y-4 p-6" data-testid="work-suggestion-empty">
                <p className="text-sm text-muted-foreground">No suggestion to display.</p>
                <Button asChild variant="outline">
                    <Link href={APP_HOME}>Back to chat</Link>
                </Button>
            </div>
        );
    }

    const candidates = suggestion.candidates;
    const assigneeCount = candidates.assigneeCandidates?.length ?? 0;
    const isProposed = suggestion.status === "proposed";
    const isConverted = suggestion.status === "converted";

    const extraFields = () => {
        const dueAt = dueAtInput.trim() ? new Date(dueAtInput).toISOString() : undefined;
        const priority = priorityInput || undefined;
        return {
            ...(dueAt !== undefined ? { dueAt } : {}),
            ...(priority ? { priority } : {}),
        };
    };

    return (
        <div className="mx-auto max-w-2xl space-y-6 p-6" data-testid="work-suggestion-detail">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold">Work suggestion</h1>
                    <p className="text-sm text-muted-foreground">
                        Accept creates a coordination task. Execution stays separate.
                    </p>
                </div>
                <Button asChild variant="outline">
                    <Link href={conversationMessageHref(suggestion.conversationId)}>Back to chat</Link>
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>{suggestion.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    <p className="text-muted-foreground whitespace-pre-wrap" data-testid="suggestion-outcome">
                        {suggestionOutcome(suggestion)}
                    </p>
                    <SuggestionTrustPanel suggestion={suggestion} />
                    <dl className="grid gap-2 sm:grid-cols-2">
                        <div>
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Status</dt>
                            <dd className="font-medium capitalize">{suggestion.status}</dd>
                        </div>
                        <div>
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Created</dt>
                            <dd className="font-medium">{formatTimestamp(suggestion.createdAt)}</dd>
                        </div>
                        <div>
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Source message</dt>
                            <dd>
                                <Link
                                    href={conversationMessageHref(suggestion.conversationId, suggestion.messageId)}
                                    className="font-medium underline underline-offset-2 hover:opacity-80"
                                    data-testid="source-message-link"
                                >
                                    {suggestion.conversationLabel?.trim() || "Open source message"}
                                </Link>
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Priority candidate</dt>
                            <dd className="font-medium">{candidates.priorityCandidate || "—"}</dd>
                        </div>
                        <div>
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Due candidate</dt>
                            <dd className="font-medium">
                                {candidates.dueAtCandidate
                                    ? formatTimestamp(candidates.dueAtCandidate)
                                    : "—"}
                            </dd>
                        </div>
                        <div className="sm:col-span-2">
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                                Assignee candidates
                            </dt>
                            <dd className="font-medium">
                                {assigneeCount > 0
                                    ? `${assigneeCount} candidate${assigneeCount === 1 ? "" : "s"}`
                                    : "—"}
                            </dd>
                        </div>
                        {suggestion.convertedTaskId ? (
                            <div className="sm:col-span-2">
                                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                                    Converted task
                                </dt>
                                <dd data-testid="converted-task-id">
                                    <Link
                                        href={taskHref(suggestion.convertedTaskId)}
                                        className="font-medium underline underline-offset-2 hover:opacity-80"
                                        data-testid="converted-task-link"
                                    >
                                        Open converted task
                                    </Link>
                                </dd>
                            </div>
                        ) : null}
                        {suggestion.dismissReason ? (
                            <div className="sm:col-span-2">
                                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                                    Dismiss reason
                                </dt>
                                <dd className="font-medium">{suggestion.dismissReason}</dd>
                            </div>
                        ) : null}
                    </dl>
                </CardContent>
            </Card>

            {(isProposed || isConverted) && (
                <Card data-testid="work-suggestion-actions">
                    <CardHeader>
                        <CardTitle className="text-base">
                            {isProposed ? "Review actions" : "Assign coordination task"}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="suggestion-due-at">Due at</Label>
                                <Input
                                    id="suggestion-due-at"
                                    data-testid="suggestion-due-at"
                                    type="datetime-local"
                                    value={dueAtInput}
                                    onChange={(event) => setDueAtInput(event.target.value)}
                                    disabled={actionPending}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="suggestion-priority">Priority</Label>
                                <select
                                    id="suggestion-priority"
                                    data-testid="suggestion-priority"
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={priorityInput}
                                    onChange={(event) =>
                                        setPriorityInput(event.target.value as TaskPriority | "")
                                    }
                                    disabled={actionPending}
                                >
                                    <option value="">Use candidate / default</option>
                                    <option value="low">low</option>
                                    <option value="medium">medium</option>
                                    <option value="high">high</option>
                                    <option value="urgent">urgent</option>
                                </select>
                            </div>
                        </div>

                        <WorkInboxTriage
                            suggestion={suggestion}
                            organizationId={organizationId ?? suggestion.organizationId}
                            members={members}
                            displayedOwners={owners}
                            currentUserId={currentUserId}
                            actionPending={actionPending}
                            actionError={actionError}
                            onAccept={(assignees) => void onAccept?.({ assignees, ...extraFields() })}
                            onDismiss={(reason) => void onDismiss?.(reason)}
                            onAssign={(assignees) => void onAssign?.({ assignees, ...extraFields() })}
                            onAllowAiTools={onAllowAiTools}
                        />
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
