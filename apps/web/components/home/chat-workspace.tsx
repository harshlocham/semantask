"use client";

import Sidebar from "@/components/home/left-panel";
import RightPanel from "@/components/home/right-panel";
import UserListDialog from "@/components/home/dialogs/user-list-dialog";
import { useOfflineMessageSync } from "@/lib/hooks/useOfflineMessageSync";
import { useEffect, useState } from "react";
import useChatStore from "@/store/chat-store";

export default function ChatWorkspace() {
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isMobileViewport, setIsMobileViewport] = useState(false);
    const [startConversationOpen, setStartConversationOpen] = useState(false);
    const selectedConversationId = useChatStore((s) => s.selectedConversationId);

    useOfflineMessageSync();

    useEffect(() => {
        const mediaQuery = window.matchMedia("(max-width: 1023px)");
        const syncViewport = () => setIsMobileViewport(mediaQuery.matches);

        syncViewport();
        mediaQuery.addEventListener("change", syncViewport);

        return () => {
            mediaQuery.removeEventListener("change", syncViewport);
        };
    }, []);

    useEffect(() => {
        if (!isMobileViewport) {
            setIsSidebarOpen(false);
            return;
        }

        setIsSidebarOpen(!selectedConversationId);
    }, [isMobileViewport, selectedConversationId]);

    useEffect(() => {
        if (!isMobileViewport || !isSidebarOpen) return;

        const prevBodyOverflow = document.body.style.overflow;
        const prevHtmlOverflow = document.documentElement.style.overflow;

        document.body.style.overflow = "hidden";
        document.documentElement.style.overflow = "hidden";

        return () => {
            document.body.style.overflow = prevBodyOverflow;
            document.documentElement.style.overflow = prevHtmlOverflow;
        };
    }, [isMobileViewport, isSidebarOpen]);

    return (
        <main className="h-full min-h-0 bg-[hsl(var(--gray-secondary))]">
            <div className="relative flex h-full min-h-0 w-full overflow-hidden bg-[hsl(var(--gray-secondary))]">
                <UserListDialog
                    open={startConversationOpen}
                    onOpenChange={setStartConversationOpen}
                    hideTrigger
                />
                <Sidebar
                    isMobileOpen={isSidebarOpen}
                    onMobileClose={
                        selectedConversationId ? () => setIsSidebarOpen(false) : undefined
                    }
                    onStartConversation={() => setStartConversationOpen(true)}
                />
                <RightPanel onStartConversation={() => setStartConversationOpen(true)} />
            </div>
        </main>
    );
}
