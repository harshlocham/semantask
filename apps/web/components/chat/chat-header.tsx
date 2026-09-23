"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import GroupMembersDialog from "@/components/home/group-members-dialog";
import { ArrowLeft, X } from "lucide-react";

interface ChatHeaderProps {
    conversationName: string;
    avatarSrc?: string;
    avatarFallbackInitial: string;
    isGroup: boolean;
    onBack: () => void;
    onClearSelection: () => void;
    onOpenTasks?: () => void;
}

export default function ChatHeader({
    conversationName,
    avatarSrc,
    avatarFallbackInitial,
    isGroup,
    onBack,
    onClearSelection,
    onOpenTasks,
}: ChatHeaderProps) {
    return (
        <div className="sticky top-0 z-30 border-b border-[hsl(var(--border))] bg-[hsl(var(--gray-primary))] px-3 py-2 sm:p-3">
            <div className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                    <button
                        type="button"
                        onClick={onBack}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] lg:hidden"
                        aria-label="Back to conversations"
                    >
                        <ArrowLeft size={18} />
                    </button>

                    <Avatar>
                        <AvatarImage
                            src={avatarSrc}
                            alt={conversationName || "User avatar"}
                            className="object-cover"
                        />
                        <AvatarFallback className="bg-[hsl(var(--gray-secondary))] text-sm font-semibold text-[hsl(var(--foreground))]">
                            {avatarFallbackInitial}
                        </AvatarFallback>
                    </Avatar>

                    <div className="flex min-w-0 flex-col">
                        <p className="truncate text-sm font-medium text-[hsl(var(--foreground))] sm:text-base">{conversationName}</p>
                        {isGroup && <GroupMembersDialog />}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {onOpenTasks ? (
                        <button
                            type="button"
                            onClick={onOpenTasks}
                            className="inline-flex h-9 items-center rounded-md border border-[hsl(var(--border))] px-3 text-sm font-medium text-[hsl(var(--foreground))] lg:hidden"
                            data-testid="open-task-drawer"
                            aria-label="Open work"
                        >
                            Work
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={onClearSelection}
                        className="hidden h-9 w-9 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--chat-hover))] lg:inline-flex"
                        aria-label="Close conversation"
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
}
