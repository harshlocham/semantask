"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlarmClock, OctagonAlert, ShieldCheck, UserRoundX } from "lucide-react";
import type {
    WorkSummary,
    WorkSummaryApprovalRow,
    WorkSummaryOpenTaskRow,
    WorkSummarySuggestionRow,
} from "@semantask/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserChip } from "@/components/people/user-chip";
import { useActiveOrganization } from "@/lib/hooks/useActiveOrganization";
import {
    mutationErrorMessage,
    useOrganizationWorkSummary,
} from "@/lib/queries/use-work-summary";
import { boardTaskHref, taskHref } from "@/lib/work-links";
import { reviewSuggestionHref } from "@/lib/work-suggestions/map";
import { cn } from "@/lib/utils/utils";

const BOARD_LABELS: Record<string, string> = {
    todo: "Todo",
    doing: "Doing",
    done: "Done",
};

function formatTimestamp(iso: string) {
    const value = new Date(iso);
    if (Number.isNaN(value.getTime())) return "-";
    return value.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDue(iso: string | null) {
    if (!iso) return "No due date";
    const value = new Date(iso);
    if (Number.isNaN(value.getTime())) return "No due date";
    return `Due ${value.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function MetricTile({
    label,
    value,
    caption,
    icon: Icon,
    alert,
}: {
    label: string;
    value: number;
    caption: string;
    icon: LucideIcon;
    alert?: boolean;
}) {
    return (
        <div className="rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-card)]">
            <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Icon aria-hidden="true" className={cn("h-3.5 w-3.5", alert && value > 0 && "text-destructive")} />
                {label}
            </dt>
            <dd className="mt-1.5 text-2xl font-semibold leading-none text-foreground">{value}</dd>
            <dd className="mt-1.5 text-[11px] text-muted-foreground">{caption}</dd>
        </div>
    );
}

function AttentionList({
    title,
    empty,
    testId,
    hasItems,
    count,
    action,
    children,
}: {
    title: string;
    empty: string;
    testId: string;
    hasItems: boolean;
    count?: number;
    action?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className="rounded-xl border border-border bg-card" data-testid={testId}>
            <header className="flex min-h-10 items-center justify-between gap-2 border-b border-border px-3 py-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    {title}
                    {typeof count === "number" ? (
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {count}
                        </span>
                    ) : null}
                </h3>
                {action}
            </header>
            {hasItems ? children : <p className="px-3 py-3 text-sm text-muted-foreground">{empty}</p>}
        </section>
    );
}

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
    return (
        <Link href={href} className="text-xs font-medium text-primary hover:underline">
            {children}
        </Link>
    );
}

function TaskAttentionRows({
    rows,
    boardEnabled,
}: {
    rows: WorkSummaryOpenTaskRow[];
    boardEnabled: boolean;
}) {
    if (rows.length === 0) return null;
    return (
        <ul className="divide-y divide-border">
            {rows.map((task) => (
                <li key={task._id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                        <Link href={taskHref(task._id)} className="block truncate text-sm font-medium hover:underline">
                            {task.title}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">
                            {BOARD_LABELS[task.boardStatus] ?? task.boardStatus} · {formatDue(task.dueAt)}
                            {task.conversationLabel ? ` · ${task.conversationLabel}` : ""}
                        </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                        {(task.assigneeRefs ?? []).slice(0, 2).map((user) => (
                            <UserChip key={user.id} user={user} size={18} className="text-xs" />
                        ))}
                        {boardEnabled ? (
                            <Link
                                href={boardTaskHref(task._id)}
                                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                            >
                                Board
                            </Link>
                        ) : null}
                    </div>
                </li>
            ))}
        </ul>
    );
}

function SuggestionRows({ rows }: { rows: WorkSummarySuggestionRow[] }) {
    if (rows.length === 0) return null;
    return (
        <ul className="divide-y divide-border">
            {rows.map((item) => (
                <li key={item._id} className="px-3 py-2">
                    <Link
                        href={reviewSuggestionHref(item._id) ?? `/inbox?suggestion=${item._id}`}
                        className="block truncate text-sm font-medium hover:underline"
                    >
                        {item.title}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                        {item.conversationLabel || "Conversation"} · {formatTimestamp(item.createdAt)}
                    </p>
                </li>
            ))}
        </ul>
    );
}

function ApprovalWidget({
    title,
    description,
    bucket,
    testId,
    approvalsHref,
}: {
    title: string;
    description: string;
    bucket: WorkSummary["agingApprovals"];
    testId: string;
    approvalsHref: string;
}) {
    return (
        <AttentionList
            title={title}
            empty="Nothing waiting right now."
            testId={testId}
            hasItems={bucket.oldest.length > 0}
            count={bucket.pending}
            action={<HeaderLink href={approvalsHref}>Open approvals</HeaderLink>}
        >
            <ul className="divide-y divide-border">
                {bucket.oldest.map((item: WorkSummaryApprovalRow) => (
                    <li key={item._id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
                                {item.toolName || "approval_request"}
                            </code>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                Requested {formatTimestamp(item.createdAt)}
                            </p>
                        </div>
                        <Link
                            href={taskHref(item.taskId)}
                            className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline"
                        >
                            Open task
                        </Link>
                    </li>
                ))}
            </ul>
            <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                {description} {bucket.aging} older than 24h.
            </p>
        </AttentionList>
    );
}

export function WorkDashboardView({ boardEnabled = false }: { boardEnabled?: boolean }) {
    const { organizationId, organization, organizationScopeReady } = useActiveOrganization();
    const summaryQuery = useOrganizationWorkSummary(organizationId);

    const error = summaryQuery.error
        ? mutationErrorMessage(summaryQuery.error, "Failed to load dashboard")
        : null;

    if (!organizationScopeReady) {
        return (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="work-dashboard-loading">
                {[0, 1, 2, 3].map((index) => (
                    <div
                        key={index}
                        className="h-20 animate-pulse rounded-xl border border-border bg-muted/40"
                    />
                ))}
            </div>
        );
    }

    if (!organizationId) {
        return (
            <div className="max-w-lg space-y-2 text-sm" data-testid="work-dashboard-onboarding">
                <p className="font-medium">Choose an organization to load the dashboard</p>
                <p className="text-muted-foreground">
                    See what needs attention across your team — overdue, blocked, unassigned, and
                    awaiting confirmation.
                </p>
                <Button asChild variant="outline" size="sm">
                    <Link href="/organizations">Open organizations</Link>
                </Button>
            </div>
        );
    }

    if (summaryQuery.isLoading && !summaryQuery.data) {
        return (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="work-dashboard-loading">
                {[0, 1, 2, 3].map((index) => (
                    <div
                        key={index}
                        className="h-20 animate-pulse rounded-xl border border-border bg-muted/40"
                    />
                ))}
            </div>
        );
    }

    if (error) {
        return (
            <Card data-testid="work-dashboard-error">
                <CardContent className="space-y-3 p-6 text-sm">
                    <p className="font-medium">Unable to load dashboard</p>
                    <p className="text-muted-foreground">{error}</p>
                    <Button
                        data-testid="work-dashboard-retry"
                        variant="outline"
                        onClick={() => void summaryQuery.refetch()}
                    >
                        Retry
                    </Button>
                </CardContent>
            </Card>
        );
    }

    if (!summaryQuery.data) {
        return null;
    }

    const summary = summaryQuery.data;
    const attention = summary.attention;
    const openCounts = summary.openWork.counts;
    const awaitingApproval = summary.agingApprovals;

    return (
        <div className="space-y-4" data-testid="work-dashboard">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-sm font-semibold text-foreground">What needs attention</h2>
                <p className="text-xs text-muted-foreground">
                    {organization?.name ?? "Organization"}
                    {attention ? ` · ${attention.counts.members} members` : ""} · updated{" "}
                    {formatTimestamp(summary.generatedAt)}
                </p>
            </div>

            {attention ? (
                <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="work-dashboard-attention-counts">
                    <MetricTile
                        label="Overdue"
                        value={attention.counts.overdue}
                        caption={`${attention.counts.open} open in total`}
                        icon={AlarmClock}
                        alert
                    />
                    <MetricTile
                        label="Awaiting approval"
                        value={awaitingApproval.pending}
                        caption={`${awaitingApproval.aging} older than 24h`}
                        icon={ShieldCheck}
                    />
                    <MetricTile
                        label="Unassigned"
                        value={attention.counts.unassigned}
                        caption="Open work without an owner"
                        icon={UserRoundX}
                    />
                    <MetricTile
                        label="Blocked"
                        value={attention.counts.blocked}
                        caption="Open work that cannot move"
                        icon={OctagonAlert}
                        alert
                    />
                </dl>
            ) : null}

            <div
                className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
                data-testid="work-dashboard-open-counts"
            >
                <span className="font-medium text-foreground">Board</span>
                <dl className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    {(["todo", "doing", "done"] as const).map((status) => (
                        <div key={status} className="flex items-center gap-1">
                            <dt>{BOARD_LABELS[status]}</dt>
                            <dd className="font-semibold text-foreground">{openCounts[status]}</dd>
                        </div>
                    ))}
                </dl>
            </div>

            {attention ? (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
                    <AttentionList
                        title="Overdue"
                        empty="No overdue work."
                        testId="work-dashboard-overdue"
                        hasItems={attention.overdue.length > 0}
                        count={attention.counts.overdue}
                    >
                        <TaskAttentionRows rows={attention.overdue} boardEnabled={boardEnabled} />
                    </AttentionList>
                    <ApprovalWidget
                        title="Awaiting approval"
                        description="Execution waiting for a manager decision."
                        bucket={awaitingApproval}
                        testId="work-dashboard-aging-approvals"
                        approvalsHref="/inbox/approvals"
                    />
                    <AttentionList
                        title="Unassigned"
                        empty="All open work has an owner."
                        testId="work-dashboard-unassigned"
                        hasItems={attention.unassigned.length > 0}
                        count={attention.counts.unassigned}
                    >
                        <TaskAttentionRows rows={attention.unassigned} boardEnabled={boardEnabled} />
                    </AttentionList>
                    <AttentionList
                        title="Awaiting confirmation"
                        empty="No proposed suggestions waiting."
                        testId="work-dashboard-awaiting"
                        hasItems={attention.awaitingConfirmation.length > 0}
                        count={attention.counts.awaitingConfirmation}
                        action={<HeaderLink href="/inbox">Open suggestions inbox</HeaderLink>}
                    >
                        <SuggestionRows rows={attention.awaitingConfirmation} />
                    </AttentionList>
                    <AttentionList
                        title="Blocked"
                        empty="Nothing blocked."
                        testId="work-dashboard-blocked"
                        hasItems={attention.blocked.length > 0}
                        count={attention.counts.blocked}
                    >
                        <TaskAttentionRows rows={attention.blocked} boardEnabled={boardEnabled} />
                    </AttentionList>
                    <AttentionList
                        title="Recently created"
                        empty="No recent open work."
                        testId="work-dashboard-recent"
                        hasItems={attention.recentlyCreated.length > 0}
                    >
                        <TaskAttentionRows rows={attention.recentlyCreated} boardEnabled={boardEnabled} />
                    </AttentionList>
                    <AttentionList
                        title="My work & team"
                        empty="No assigned open work yet."
                        testId="work-dashboard-by-owner"
                        hasItems={attention.byOwner.length > 0}
                    >
                        <ul className="divide-y divide-border">
                            {attention.byOwner.map((bucket) => (
                                <li key={bucket.user.id} className="flex items-center justify-between gap-2 px-3 py-2">
                                    <UserChip user={bucket.user} size={20} />
                                    <span className="text-xs font-medium text-muted-foreground">
                                        {bucket.openCount} open
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </AttentionList>
                    <ApprovalWidget
                        title="Pending high-risk tools"
                        description="High-risk tools such as email or scheduling."
                        bucket={summary.highRiskPending}
                        testId="work-dashboard-high-risk"
                        approvalsHref="/inbox/approvals"
                    />
                </div>
            ) : (
                <ApprovalWidget
                    title="Awaiting approval"
                    description="Execution waiting for a manager decision."
                    bucket={awaitingApproval}
                    testId="work-dashboard-aging-approvals"
                    approvalsHref="/inbox/approvals"
                />
            )}
        </div>
    );
}
