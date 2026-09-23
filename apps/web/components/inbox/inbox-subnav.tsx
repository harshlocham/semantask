"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    CheckSquare,
    Inbox,
    LayoutDashboard,
    MessageSquare,
    ShieldCheck,
    type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/utils";

type NavItem = {
    href: string;
    label: string;
    testId: string;
    icon: LucideIcon;
    count?: number;
    countTestId?: string;
};

function isActive(pathname: string, href: string) {
    if (href === "/app") {
        return pathname === "/app" || pathname.startsWith("/c/");
    }
    if (href === "/inbox") {
        return pathname === "/inbox" || pathname.startsWith("/work-suggestions/");
    }
    return pathname === href || pathname.startsWith(`${href}/`);
}

export function InboxSubnav({
    boardEnabled = false,
    dashboardEnabled = false,
    suggestionCount,
    approvalCount,
    onNavigate,
}: {
    boardEnabled?: boolean;
    dashboardEnabled?: boolean;
    suggestionCount?: number;
    approvalCount?: number;
    onNavigate?: () => void;
}) {
    const pathname = usePathname() ?? "";
    const links: NavItem[] = [
        {
            href: "/app",
            label: "Conversations",
            testId: "workspace-nav-conversations",
            icon: MessageSquare,
        },
        {
            href: "/inbox",
            label: "Suggestions",
            testId: "inbox-nav-suggestions",
            icon: Inbox,
            count: suggestionCount,
            countTestId: "nav-suggestion-count",
        },
        {
            href: "/inbox/approvals",
            label: "Approvals",
            testId: "inbox-nav-approvals",
            icon: ShieldCheck,
            count: approvalCount,
            countTestId: "nav-approval-count",
        },
        ...(boardEnabled
            ? [{
                href: "/inbox/board",
                label: "Board",
                testId: "inbox-nav-board",
                icon: CheckSquare,
            }]
            : []),
        ...(dashboardEnabled
            ? [{
                href: "/inbox/dashboard",
                label: "Dashboard",
                testId: "inbox-nav-dashboard",
                icon: LayoutDashboard,
            }]
            : []),
    ];

    return (
        <nav
            className="flex flex-col gap-1"
            aria-label="Work inbox sections"
            data-testid="inbox-subnav"
        >
            {links.map((link) => {
                const active = isActive(pathname, link.href);
                const Icon = link.icon;
                const showCount = typeof link.count === "number" && link.count > 0;
                return (
                    <Link
                        key={link.href}
                        href={link.href}
                        data-testid={link.testId}
                        aria-current={active ? "page" : undefined}
                        onClick={() => onNavigate?.()}
                        className={cn(
                            "flex h-8 items-center gap-2 rounded-md px-2 text-[13px] font-medium text-muted-foreground outline-none transition-colors hover:bg-background/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                            active && "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary"
                        )}
                    >
                        <Icon aria-hidden="true" size={16} />
                        <span>{link.label}</span>
                        {showCount ? (
                            <span
                                data-testid={link.countTestId}
                                className="ml-auto rounded-lg bg-primary/10 px-1.5 text-xs tabular-nums text-primary"
                            >
                                {link.count}
                            </span>
                        ) : null}
                    </Link>
                );
            })}
        </nav>
    );
}
