"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu } from "lucide-react";
import { InboxSubnav } from "@/components/inbox/inbox-subnav";
import { OrganizationSwitcher } from "@/components/organizations/organization-switcher";
import { WorkSearchBox } from "@/components/work/work-search-box";
import UserProfile from "@/components/home/userProfile";
import { useUser } from "@/context/UserContext";
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
    if (pathname === "/organizations") {
        return {
            title: "Organization settings",
            description: "Members, invitations, and execution policy for your workspace.",
        };
    }
    if (pathname === "/account") {
        return {
            title: "Account",
            description: "Change your password or revoke every signed-in session.",
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
    const { user } = useUser();
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

    function renderLogout() {
        return (
            <button
                type="button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Log out"
                onClick={logout}
            >
                <LogOut aria-hidden="true" size={16} />
            </button>
        );
    }

    return (
        <Dialog open={navOpen} onOpenChange={setNavOpen}>
        <div className="flex h-dvh min-h-0 w-full overflow-hidden bg-background">
            <aside className="hidden h-full w-[188px] shrink-0 flex-col border-r border-border bg-muted/40 lg:flex">
                <div className="flex h-12 items-center px-3">
                    <p className="text-[13px] font-semibold tracking-tight text-foreground">Semantask</p>
                </div>
                <div className="px-2 pb-3">
                    <OrganizationSwitcher variant="sidebar" />
                </div>
                <div className="px-2 pb-3">{renderNav()}</div>
                <div className="mt-auto flex items-center gap-2 border-t border-border px-2 py-2">
                    <UserProfile />
                    <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                        {user?.username ?? ""}
                    </p>
                    {renderLogout()}
                </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
                <header
                    className={cn(
                        "relative z-30 flex min-h-12 shrink-0 items-center gap-2 border-b border-border bg-background py-1.5 pl-2 pr-24 sm:pl-3 lg:pl-5",
                        isChat && "lg:hidden"
                    )}
                >
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
                            <h1 className="truncate text-[15px] font-semibold text-foreground">{chrome.title}</h1>
                            <p className="truncate text-xs text-muted-foreground">{chrome.description}</p>
                        </div>
                    ) : (
                        <p className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight lg:sr-only">Semantask</p>
                    )}
                    {pathname.startsWith("/inbox") ? (
                        <div className="hidden w-72 shrink-0 md:flex">
                            <WorkSearchBox />
                        </div>
                    ) : null}
                    <div className="ml-auto flex shrink-0 items-center gap-2 lg:hidden">
                        <div className="hidden sm:block">
                            <OrganizationSwitcher />
                        </div>
                        <UserProfile />
                        {renderLogout()}
                    </div>
                </header>

                <div className={cn("relative min-h-0 flex-1", isChat ? "overflow-hidden" : "overflow-y-auto")}>
                    <div className={isChat ? "h-full" : undefined}>{children}</div>
                </div>
            </div>

            <DialogContent id="workspace-nav-dialog" className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>Semantask</DialogTitle>
                    <DialogDescription>Workspace sections</DialogDescription>
                </DialogHeader>
                <OrganizationSwitcher variant="sidebar" />
                {renderNav()}
            </DialogContent>
        </div>
        </Dialog>
    );
}
