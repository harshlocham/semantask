"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu } from "lucide-react";
import { InboxSubnav } from "@/components/inbox/inbox-subnav";
import { OrganizationSwitcher } from "@/components/organizations/organization-switcher";
import UserProfile from "@/components/home/userProfile";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { useActiveOrganization } from "@/hooks/useActiveOrganization";
import { useTaskApprovalsList } from "@/lib/queries/use-task-approvals";
import { useWorkSuggestionsList } from "@/lib/queries/use-work-suggestions";
import { authenticatedFetch } from "@/lib/utils/api";
import { getSocket } from "@/lib/socket/socketClient";
import { cn } from "@/lib/utils/utils";

function routeChrome(pathname: string): { title: string; description: string } | null {
    if (pathname === "/app" || pathname.startsWith("/c/")) return null;
    if (pathname.startsWith("/work-suggestions/")) {
        return {
            title: "Suggestion",
            description: "Review this detected work before it becomes a task.",
        };
    }
    if (pathname === "/inbox") {
        return {
            title: "Suggestions",
            description: "Potential work waiting for a person to review.",
        };
    }
    if (pathname.startsWith("/inbox/approvals")) {
        return {
            title: "Approvals",
            description: "Tool actions that need permission before they run.",
        };
    }
    if (pathname.startsWith("/inbox/board")) {
        return {
            title: "Board",
            description: "Coordination columns for accepted work.",
        };
    }
    if (pathname.startsWith("/inbox/dashboard")) {
        return {
            title: "Dashboard",
            description: "What needs attention in this organization.",
        };
    }
    if (pathname.startsWith("/work/")) {
        return {
            title: "Work",
            description: "Coordination and run state for this task.",
        };
    }
    return null;
}

export function WorkspaceShell({
    boardEnabled = false,
    dashboardEnabled = false,
    children,
}: {
    boardEnabled?: boolean;
    dashboardEnabled?: boolean;
    children: React.ReactNode;
}) {
    const pathname = usePathname() ?? "";
    const router = useRouter();
    const [navOpen, setNavOpen] = useState(false);
    const { organizationId } = useActiveOrganization();
    const suggestionsQuery = useWorkSuggestionsList({
        organizationId,
        status: "proposed",
        page: 1,
        limit: 1,
        enabled: Boolean(organizationId),
    });
    const approvalsQuery = useTaskApprovalsList({ organizationId });
    const chrome = routeChrome(pathname);
    const isChat = chrome === null && (pathname === "/app" || pathname.startsWith("/c/"));
    const suggestionCount = organizationId && suggestionsQuery.data
        ? suggestionsQuery.data.pagination.total
        : undefined;
    const approvalCount = organizationId && approvalsQuery.data
        ? approvalsQuery.data.length
        : undefined;

    function logout() {
        const socket = getSocket();
        if (socket.connected) {
            socket.disconnect();
        }
        void authenticatedFetch("/api/auth/logout", { method: "POST" }).then(() => {
            router.push("/login");
        });
    }

    function renderNav() {
        return (
            <InboxSubnav
                boardEnabled={boardEnabled}
                dashboardEnabled={dashboardEnabled}
                suggestionCount={suggestionCount}
                approvalCount={approvalCount}
                onNavigate={() => setNavOpen(false)}
            />
        );
    }

    return (
        <Dialog open={navOpen} onOpenChange={setNavOpen}>
        <div className="flex h-dvh min-h-0 w-full overflow-hidden bg-background">
            <aside className="hidden h-full w-[220px] shrink-0 flex-col border-r border-border lg:flex">
                <div className="px-4 py-4">
                    <p className="text-sm font-semibold tracking-tight">Semantask</p>
                </div>
                <div className="px-2 pb-4">{renderNav()}</div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
                <header className="relative z-30 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b border-border bg-background py-2 pl-3 pr-24 sm:flex-nowrap sm:gap-3 sm:pl-4">
                    <DialogTrigger asChild>
                        <button
                            type="button"
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
                            aria-label="Open navigation"
                            aria-expanded={navOpen}
                            aria-controls="workspace-nav-dialog"
                            data-testid="workspace-nav-menu"
                        >
                            <Menu aria-hidden="true" size={18} />
                        </button>
                    </DialogTrigger>
                    {chrome ? (
                        <div className="min-w-0 flex-1">
                            <h1 className="truncate text-sm font-semibold text-foreground">{chrome.title}</h1>
                            <p className="truncate text-xs text-muted-foreground">{chrome.description}</p>
                        </div>
                    ) : (
                        <p className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight lg:sr-only">Semantask</p>
                    )}
                    <div className="flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-auto">
                        <div className="min-w-0 flex-1 sm:flex-none">
                            <OrganizationSwitcher />
                        </div>
                        <UserProfile />
                        <button
                            type="button"
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label="Log out"
                            onClick={logout}
                        >
                            <LogOut aria-hidden="true" size={18} />
                        </button>
                    </div>
                </header>

                <div className={cn("relative z-0 min-h-0 flex-1", isChat ? "overflow-hidden" : "overflow-y-auto")}>
                    <div className={isChat ? "h-full" : undefined}>{children}</div>
                </div>
            </div>

            <DialogContent id="workspace-nav-dialog" className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>Semantask</DialogTitle>
                    <DialogDescription>Workspace sections</DialogDescription>
                </DialogHeader>
                {renderNav()}
            </DialogContent>
        </div>
        </Dialog>
    );
}
