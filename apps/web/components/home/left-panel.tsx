"use client";

import { useEffect, useMemo, useState } from "react";
import { ListFilter, MessageSquareDiff, Search, X } from "lucide-react";
import { Input } from "../ui/input";
import ThemeSwitch from "./theme-switch";
import useChatStore from "@/store/chat-store";
import { ClientUser, ClientConversation } from "@semantask/types";
import VirtualConversationList from "../sidebar/VirtualConversationList";
import { authenticatedFetch } from "@/lib/utils/api";
import { recordApiTiming } from "@/lib/utils/performance";

function isUser(p: unknown): p is ClientUser {
    return typeof p === "object" && p !== null && "username" in p;
}

interface SidebarProps {
    isMobileOpen?: boolean;
    onMobileClose?: () => void;
    initialConversations?: ClientConversation[];
    onStartConversation?: () => void;
}

const Sidebar = ({
    isMobileOpen = false,
    onMobileClose,
    onStartConversation,
}: SidebarProps) => {
    const conversations = useChatStore((s) => s.conversations);
    const setConversations = useChatStore((s) => s.setConversations);
    const setSelectedConversation = useChatStore((s) => s.setSelectedConversation);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);

    // Fetch conversations with explicit cancellation and retry handling.
    useEffect(() => {
        const controller = new AbortController();
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let active = true;

        const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

        const isRetryable = (error: unknown) => {
            if (error instanceof DOMException && error.name === "AbortError") {
                return false;
            }

            return error instanceof TypeError || error instanceof SyntaxError || error instanceof Error;
        };

        const fetchConversations = async () => {
            try {
                setLoading(true);
                setFetchError(null);

                timeoutId = setTimeout(() => controller.abort(), 10000);

                let lastError: unknown = null;

                for (let attempt = 0; attempt < 2; attempt += 1) {
                    try {
                        const startedAt = performance.now();
                        const response = await authenticatedFetch("/api/conversations", {
                            signal: controller.signal,
                        });

                        const rawText = await response.text();

                        if (!response.ok) {
                            throw new Error(rawText || `Failed to load conversations (${response.status})`);
                        }

                        const parsed = rawText ? JSON.parse(rawText) : [];
                        const conversations = Array.isArray(parsed) ? parsed : (parsed.conversations ?? []);

                        recordApiTiming("/api/conversations", performance.now() - startedAt);

                        if (!controller.signal.aborted && active) {
                            setConversations(conversations || []);
                        }
                        return;
                    } catch (error) {
                        lastError = error;
                        if (controller.signal.aborted || !isRetryable(error) || attempt === 1) {
                            throw error;
                        }

                        await sleep(250 * (attempt + 1));
                    }
                }

                throw lastError ?? new Error("Failed to load conversations");
            } catch (err) {
                if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
                    return;
                }

                console.error("Failed to fetch conversations:", err);
                setFetchError("Unable to load conversations. Tap to retry.");
            } finally {
                if (timeoutId) clearTimeout(timeoutId);
                if (active) {
                    setLoading(false);
                }
            }
        };

        fetchConversations();

        return () => {
            active = false;
            if (timeoutId) clearTimeout(timeoutId);
            controller.abort();
        };
    }, [setConversations]);

    useEffect(() => {
        const handler = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(handler);
    }, [search]);

    const filteredConversations = useMemo(() => {
        const term = debouncedSearch.toLowerCase();

        const filtered = conversations.filter((conversation) => {
            if (!term) return true;

            if (conversation.isGroup && conversation.groupName?.toLowerCase().includes(term)) {
                return true;
            }

            if (
                conversation.participants?.some(
                    (participant) => isUser(participant) && participant.username.toLowerCase().includes(term)
                )
            ) {
                return true;
            }

            if (conversation.lastMessage?.content?.toLowerCase().includes(term)) {
                return true;
            }

            return false;
        });

        return filtered.sort(
            (a, b) =>
                new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() -
                new Date(a.updatedAt ?? a.createdAt ?? 0).getTime()
        );
    }, [conversations, debouncedSearch]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== "Enter" || !debouncedSearch) return;

        const existingDM = conversations.find(
            (conversation) =>
                !conversation.isGroup &&
                conversation.participants?.some(
                    (participant) =>
                        isUser(participant) &&
                        participant.username.toLowerCase().includes(debouncedSearch.toLowerCase())
                )
        );

        if (existingDM) {
            setSelectedConversation(existingDM);
            onMobileClose?.();
        }
    };

    const panelContent = (isMobile = false) => (
        <>
            <div className="flex h-12 items-center gap-2 border-b border-border px-3">
                <p className="text-[13px] font-semibold text-foreground">Conversations</p>
                <div className="ml-auto flex items-center gap-1">
                    <button
                        type="button"
                        onClick={onStartConversation}
                        data-testid="start-conversation-icon"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
                        aria-label="Start a conversation"
                        title="Start a conversation"
                    >
                        <MessageSquareDiff size={16} />
                    </button>
                    <ThemeSwitch />
                    {isMobile && onMobileClose ? (
                        <button
                            type="button"
                            onClick={onMobileClose}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground"
                            aria-label="Close conversations"
                        >
                            <X size={16} />
                        </button>
                    ) : null}
                </div>
            </div>

            <div className="border-b border-border px-3 py-2">
                <div className="relative">
                    <Search
                        className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
                        size={14}
                    />
                    <Input
                        type="text"
                        placeholder="Search conversations"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="h-8 rounded-md border-border bg-muted/40 py-1 pr-8 pl-8 text-[13px] shadow-none"
                    />
                    <ListFilter className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground" size={14} />
                </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[hsl(var(--left-panel))] px-1 pb-2">
                {loading && conversations.length === 0 && (
                    <div className="space-y-2 p-2">
                        {[...Array(6)].map((_, i) => (
                            <div
                                key={i}
                                className="h-10 animate-pulse rounded-md bg-muted"
                            />
                        ))}
                    </div>
                )}

                {!loading && fetchError && (
                    <p className="mt-6 text-center text-sm text-red-500">
                        {fetchError}
                    </p>
                )}

                {!loading && !fetchError && conversations.length === 0 && (
                    <div
                        className="mt-6 flex flex-col items-center gap-3 px-4 text-center text-sm text-[hsl(var(--muted-foreground))]"
                        data-testid="conversations-empty"
                    >
                        <p>Start a conversation to extract reviewable work.</p>
                        <button
                            type="button"
                            onClick={onStartConversation}
                            data-testid="start-conversation"
                            className="text-sm font-medium text-[hsl(var(--foreground))] underline underline-offset-2"
                        >
                            Start a conversation
                        </button>
                    </div>
                )}

                {!loading && !fetchError && conversations.length > 0 && filteredConversations.length === 0 && (
                    <div className="mt-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
                        No conversations found
                    </div>
                )}

                <div className="min-h-0 flex-1">
                    {!fetchError && filteredConversations.length > 0 && <VirtualConversationList />}
                </div>
            </div>
        </>
    );

    return (
        <>
            <div
                className={`absolute inset-0 z-40 bg-black/40 transition-opacity duration-300 lg:hidden ${isMobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
                    }`}
                onClick={onMobileClose}
                aria-hidden="true"
            />

            <aside
                className={`absolute inset-0 z-50 flex h-full w-full flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--left-panel))] text-[hsl(var(--foreground))] shadow-lg transition-transform duration-300 ease-out lg:hidden ${isMobileOpen ? "translate-x-0" : "-translate-x-full"
                    }`}
                role="dialog"
                aria-modal="true"
                aria-label="Conversations"
            >
                {panelContent(true)}
            </aside>

            <aside className="hidden h-full w-[272px] min-w-[272px] shrink-0 flex-col border-r border-border bg-card lg:flex">
                {panelContent(false)}
            </aside>
        </>
    );
};

export default Sidebar;