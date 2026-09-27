"use client";

import { useEffect, useMemo, useState } from "react";
import type { UserRef, WorkSuggestionRecord } from "@semantask/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserChip, userDisplayName } from "@/components/people/user-chip";

export type OrgMemberOption = {
    userId: string;
    role: string;
    user: UserRef;
};

export type WorkInboxTriageProps = {
    suggestion: WorkSuggestionRecord;
    organizationId: string | null;
    members: OrgMemberOption[];
    displayedOwners: string[];
    currentUserId?: string | null;
    actionPending: boolean;
    actionError: string | null;
    onAccept: (assignees: string[]) => void | Promise<void>;
    onAssign: (assignees: string[]) => void | Promise<void>;
    onDismiss: (reason: string) => void | Promise<void>;
    onAllowAiTools?: () => void | Promise<void>;
};

function uniqueIds(ids: string[]): string[] {
    return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
}

function memberLabel(member: OrgMemberOption): string {
    return `${userDisplayName(member.user)} (${member.role})`;
}

export function WorkInboxTriage({
    suggestion,
    organizationId,
    members,
    displayedOwners,
    currentUserId = null,
    actionPending,
    actionError,
    onAccept,
    onAssign,
    onDismiss,
    onAllowAiTools,
}: WorkInboxTriageProps) {
    const isProposed = suggestion.status === "proposed";
    const isConverted = suggestion.status === "converted";
    const canAssign = isConverted;
    const canAcceptOrDismiss = isProposed;
    const UNASSIGNED = "";

    const memberById = useMemo(() => {
        const map = new Map<string, OrgMemberOption>();
        for (const member of members) {
            map.set(member.userId, member);
        }
        return map;
    }, [members]);

    const selectableIds = useMemo(() => {
        const ids = new Set<string>();
        if (currentUserId) ids.add(currentUserId);
        for (const member of members) ids.add(member.userId);
        return ids;
    }, [currentUserId, members]);

    const candidateDefaults = useMemo(
        () => uniqueIds(suggestion.candidates.assigneeCandidates ?? []),
        [suggestion.candidates.assigneeCandidates]
    );

    function defaultOwner(from: string[]): string[] {
        const seed = uniqueIds(from.length > 0 ? from : candidateDefaults);
        const next = seed.find((id) => selectableIds.has(id));
        return next ? [next] : [];
    }

    const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(() =>
        defaultOwner(displayedOwners)
    );
    const [dismissReason, setDismissReason] = useState("");

    useEffect(() => {
        const next = defaultOwner(displayedOwners);
        setSelectedMemberIds((current) => {
            const currentId = current[0] ?? UNASSIGNED;
            const nextId = next[0] ?? UNASSIGNED;
            return currentId === nextId ? current : next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [suggestion._id, displayedOwners, selectableIds, candidateDefaults]);

    function resolveAssignees(): string[] {
        return uniqueIds(selectedMemberIds).slice(0, 1);
    }

    const selectedOwnerId = selectedMemberIds[0] ?? UNASSIGNED;
    const currentOwners = displayedOwners
        .filter((id) => selectableIds.has(id) || memberById.has(id))
        .map((id) => memberById.get(id)?.user ?? { id, username: "Unknown user" });

    return (
        <div className="space-y-1.5" data-testid="work-inbox-triage">
            <div className="flex gap-1.5">
                <Label htmlFor={`inbox-owner-${suggestion._id}`} className="sr-only">Owner</Label>
                <select
                    id={`inbox-owner-${suggestion._id}`}
                    data-testid="suggestion-assignees"
                    className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-[13px]"
                    value={selectedOwnerId}
                    disabled={actionPending || (!canAcceptOrDismiss && !canAssign)}
                    onChange={(event) => {
                        const value = event.target.value;
                        setSelectedMemberIds(value ? [value] : []);
                    }}
                >
                    <option value={UNASSIGNED}>Unassigned</option>
                    {currentUserId ? <option value={currentUserId}>Me</option> : null}
                    {members
                        .filter((member) => member.userId !== currentUserId)
                        .map((member) => (
                            <option key={member.userId} value={member.userId}>
                                {memberLabel(member)}
                            </option>
                        ))}
                </select>
                <Button
                    data-testid="suggestion-assign"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg"
                    disabled={actionPending || !canAssign}
                    title={canAssign ? "Update converted task owner" : "Accept first"}
                    onClick={() => void onAssign(resolveAssignees())}
                >
                    Assign
                </Button>
                <Button
                    data-testid="suggestion-accept"
                    size="sm"
                    className="h-8 rounded-lg"
                    disabled={actionPending || !canAcceptOrDismiss}
                    onClick={() => void onAccept(resolveAssignees())}
                >
                    Accept & assign
                </Button>
            </div>
            {canAcceptOrDismiss ? (
                <div className="flex gap-1.5">
                    <Label htmlFor={`inbox-dismiss-${suggestion._id}`} className="sr-only">Dismiss reason</Label>
                    <Input
                        id={`inbox-dismiss-${suggestion._id}`}
                        data-testid="suggestion-dismiss-reason"
                        className="h-8 min-w-0 flex-1 rounded-lg text-[13px]"
                        value={dismissReason}
                        onChange={(event) => setDismissReason(event.target.value)}
                        placeholder="Reason required to dismiss"
                        disabled={actionPending}
                    />
                    <Button
                        data-testid="suggestion-dismiss"
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-lg"
                        disabled={actionPending || !dismissReason.trim()}
                        onClick={() => void onDismiss(dismissReason.trim())}
                    >
                        Dismiss
                    </Button>
                </div>
            ) : null}
            {isConverted && suggestion.convertedTaskId ? (
                <Button
                    data-testid="suggestion-allow-ai-tools"
                    size="sm"
                    variant="outline"
                    className="h-8 w-full rounded-lg"
                    disabled={actionPending || !onAllowAiTools}
                    onClick={() => void onAllowAiTools?.()}
                >
                    Allow AI tools
                </Button>
            ) : null}
            {currentOwners.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="work-inbox-owner">
                    <span>Owner</span>
                    {currentOwners.map((user) => (
                        <UserChip key={user.id} user={user} size={18} />
                    ))}
                </div>
            ) : (
                <p className="text-[11px] text-muted-foreground" data-testid="work-inbox-owner">No owner selected</p>
            )}
            <p className="text-[11px] text-muted-foreground">
                {isProposed
                    ? "Accept creates a task. It does not run tools."
                    : "Allow AI tools requests execution approval — separate from accepting a suggestion."}
                {!organizationId ? " Personal workspace: Me or Unassigned only." : null}
            </p>

            {actionError ? (
                <p className="text-xs text-destructive" data-testid="suggestion-action-error">
                    {actionError}
                </p>
            ) : null}
        </div>
    );
}
