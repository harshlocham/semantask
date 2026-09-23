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
        <div className="sticky top-0 z-30 flex h-12 items-center justify-between gap-2 border-b border-border bg-background px-3">
                <div className="flex min-w-0 items-center gap-2">
                    <button
                        type="button"
                        onClick={onBack}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground lg:hidden"
                        aria-label="Back to conversations"
                    >
                        <ArrowLeft size={18} />
                    </button>

                    <Avatar className="h-7 w-7">
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
                        <p className="truncate text-sm font-medium text-foreground">{conversationName}</p>
                        {isGroup && <GroupMembersDialog />}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {onOpenTasks ? (
                        <button
                            type="button"
                            onClick={onOpenTasks}
                            className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium text-foreground lg:hidden"
                            data-testid="open-task-drawer"
                            aria-label="Open work"
                        >
                            Work
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={onClearSelection}
                        className="hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent lg:inline-flex"
                        aria-label="Close conversation"
                    >
                        <X size={18} />
                    </button>
                </div>
        </div>
    );
}
