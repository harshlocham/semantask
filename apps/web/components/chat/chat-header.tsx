"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import GroupMembersDialog from "@/components/home/group-members-dialog";
import { ArrowLeft, X, PhoneIcon } from "lucide-react";

interface ChatHeaderProps {
    conversationName: string;
    avatarSrc?: string;
    avatarFallbackInitial: string;
    isGroup: boolean;
    canStartCall: boolean;
    onStartCall: () => void;
    onBack: () => void;
    onClearSelection: () => void;
}

export default function ChatHeader({
    conversationName,
    avatarSrc,
    avatarFallbackInitial,
    isGroup,
    canStartCall,
    onStartCall,
    onBack,
    onClearSelection,
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
                <div className="hidden items-center gap-2 lg:flex">
                    {canStartCall && (
                        <button
                            type="button"
                            onClick={onStartCall}
                            disabled={!canStartCall}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:border-[hsl(var(--border))] disabled:bg-transparent disabled:text-[hsl(var(--muted-foreground))]"
                            aria-label="Start video call"
                            title={canStartCall ? "Start video call" : "Calling is unavailable for this conversation"}
                        >
                            <PhoneIcon size={16} />
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={onClearSelection}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--chat-hover))]"
                        aria-label="Close conversation"
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
}
