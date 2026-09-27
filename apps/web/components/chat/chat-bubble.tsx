import React from "react";
import useChatStore from "@/store/chat-store";
import { Image } from "@imagekit/next";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState } from "react";
import {
    Smile,
    MessageCircle,
    Edit,
    Trash2,
    Paperclip,
    MoreHorizontal,
} from "lucide-react";
import { ReactionBar } from "../chat/reaction-bar";
import { ClientUser } from "@semantask/types";
import { motion, AnimatePresence } from "framer-motion";
import { UIMessage } from "@semantask/types";
import ChatBubbleAvatar from "../home/chat-bubble-avatar";
import { IntentBadge } from "./intent-badge";
import { ConversationSuggestionCard } from "./conversation-suggestion-card";
import { reviewSuggestionHref } from "@/lib/work-suggestions/map";
import { DEEP_LINK_HIGHLIGHT_CLASS } from "@/lib/deep-link-highlight";
import { cn } from "@/lib/utils/utils";
import { useUser } from "@/context/UserContext";
import type { WorkSuggestionRecord } from "@semantask/types";

interface ChatBubbleProps {
    message: UIMessage;
    currentUserId: string;
    onDelete: (msgId: string) => void;
    onReply: (msg: UIMessage) => void;
    onReact: (msg: UIMessage, emoji: string) => void;
    showAvatar?: boolean;
    showUsername?: boolean;
    /** Existing WorkSuggestion id for this message, if any. */
    suggestionId?: string | null;
    /** Full suggestion record when the conversation store has one. */
    suggestion?: WorkSuggestionRecord | null;
    highlighted?: boolean;
}

// --------- Small helpers ---------
function isUser(obj: unknown): obj is ClientUser {
    return (
        typeof obj === "object" &&
        obj !== null &&
        "username" in obj &&
        typeof (obj as ClientUser).username === "string"
    );
}

function isPopulatedMessage(obj: unknown): obj is UIMessage {
    return (
        typeof obj === "object" &&
        obj !== null &&
        "content" in obj &&
        "sender" in obj
    );
}

function getFileNameFromUrl(url: string) {
    try {
        const withoutQuery = url.split("?")[0];
        const parts = withoutQuery.split("/");
        return parts[parts.length - 1] || "file";
    } catch {
        return "file";
    }
}

const ChatBubble = ({
    message,
    currentUserId,
    onDelete,
    onReply,
    onReact,
    showAvatar = true,
    showUsername = true,
    suggestionId = null,
    suggestion = null,
    highlighted = false,
}: ChatBubbleProps) => {
    const selectedConversation = useChatStore((s) => s.selectedConversation);
    const setEditingMessage = useChatStore((s) => s.setEditingMessage);
    const { user: me } = useUser();
    const [showReactions, setShowReactions] = useState(false);
    //const [hovered, setHovered] = useState(false);
    const senderId =
        typeof message.sender === "string"
            ? message.sender
            : message.sender?._id;

    const isMine = String(senderId) === String(currentUserId);
    // reactions: { emoji: string; users: (string | {_id:string})[] }[]
    const rawReactions = message.reactions ?? [];

    // Group by emoji
    const groupedReactions = rawReactions.reduce((acc, r) => {
        if (!acc[r.emoji]) {
            acc[r.emoji] = [];
        }

        acc[r.emoji].push(...r.users); // spread array
        return acc;
    }, {} as Record<string, string[]>);

    const hasReactions = Object.keys(groupedReactions).length > 0;

    const receiptState = (() => {
        if (!isMine) return null;

        if (message.status === "pending" || message.status === "queued") {
            return "sending" as const;
        }

        if (message.status === "seen" || message.seen || (message.seenBy?.length ?? 0) > 0) {
            return "seen" as const;
        }

        if (
            message.status === "delivered" ||
            message.delivered ||
            (message.deliveredTo?.length ?? 0) > 0
        ) {
            return "delivered" as const;
        }

        return "sent" as const;
    })();

    const getRepliedPreview = () => {
        const replied = (message).repliedTo;

        if (!replied) return null;
        if (!isPopulatedMessage(replied)) {
            // Not populated, just show a generic line
            return (
                <span className="text-xs italic opacity-70">
                    Replying to a message…
                </span>
            );
        }

        const repliedSender = replied.sender;
        let name = "Someone";
        if (isUser(repliedSender)) {
            name =
                repliedSender._id?.toString() === currentUserId
                    ? "You"
                    : repliedSender.username;
        }

        let snippet: string;
        switch (replied.messageType) {
            case "image":
                snippet = "📷 Image";
                break;
            case "video":
                snippet = "📹 Video";
                break;
            case "audio":
            case "voice":
                snippet = "🎧 Audio message";
                break;
            case "file":
                snippet = `📎 ${getFileNameFromUrl(replied.content)}`;
                break;
            default:
                snippet = replied.content;
        }

        return (
            <div
                className="mb-2 cursor-pointer rounded-md border-l-2 border-[hsl(var(--border))] bg-[hsl(var(--gray-secondary))] p-2 text-xs text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--chat-hover))]"
                onClick={() => {
                    const origId = message.repliedTo?._id;
                    if (origId) {
                        document.getElementById(origId)?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }
                }}
            >
                <div className="font-semibold mb-0.5">{name}</div>
                <div className="line-clamp-2 break-words opacity-80">{snippet}</div>
            </div>
        );
    };

    const renderContent = () => {
        if (message.isDeleted) {
            return (
                <div className="mb-1 border-l-2 border-[hsl(var(--border))] pl-2 text-xs text-[hsl(var(--muted-foreground))]">
                    <p className="text-sm break-words leading-relaxed">This message was deleted</p>
                </div>
            );
        }

        const type = (message).messageType as
            | "text"
            | "image"
            | "video"
            | "audio"
            | "voice"
            | "file";

        switch (type) {
            case "image":
                return (
                    <Image
                        urlEndpoint={process.env.NEXT_PUBLIC_URI_ENDPOINT as string}
                        src={message.content}
                        alt="Message image"
                        width={320}
                        height={240}
                        className="h-auto w-full max-w-[min(82vw,320px)] cursor-pointer rounded-lg object-cover transition-opacity hover:opacity-90 sm:max-w-[320px]"
                        onClick={() => window.open(message.content, "_blank")}
                    />
                );

            case "video":
                return (
                    <video
                        controls
                        className="rounded-lg cursor-pointer max-w-full h-auto"
                    >
                        <source src={message.content} type="video/mp4" />
                        Your browser does not support the video tag.
                    </video>
                );

            case "audio":
            case "voice":
                return (
                    <audio
                        controls
                        className="w-full max-w-55 sm:max-w-xs"
                    >
                        <source src={message.content} />
                        Your browser does not support the audio element.
                    </audio>
                );

            case "file":
                return (
                    <a
                        href={message.content}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-lg bg-[hsl(var(--gray-secondary))] p-2 transition hover:bg-[hsl(var(--chat-hover))]"
                    >
                        <Paperclip className="w-4 h-4" />
                        <span className="text-xs break-all line-clamp-1">
                            {getFileNameFromUrl(message.content)}
                        </span>
                    </a>
                );

            case "text":
            default:
                return <p className="text-sm break-words leading-relaxed">{message.content}</p>;
        }
    };

    const senderInfo = isUser(message.sender)
        ? message.sender
        : isMine && me
            ? { username: me.username, profilePicture: me.profilePicture }
            : null;
    const senderName = senderInfo?.username ?? "Unknown";
    const showHeader = showAvatar || showUsername;
    const timeLabel = new Date(message.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    });
    const receipt = receiptState === "sending"
        ? <span className="text-[11px] text-muted-foreground">Sending…</span>
        : receiptState === "sent"
            ? <span className="text-[11px] text-muted-foreground" aria-label="Sent">✓</span>
            : receiptState === "delivered"
                ? <span className="text-[11px] text-muted-foreground" aria-label="Delivered">✓✓</span>
                : receiptState === "seen"
                    ? <span className="text-[11px] text-primary" aria-label="Seen">✓✓</span>
                    : null;
    const intentBadge = message.aiStatus === "classified" && message.semanticType && !suggestion ? (
        <IntentBadge
            semanticType={message.semanticType}
            confidence={message.semanticConfidence}
            reviewHref={reviewSuggestionHref(suggestionId)}
        />
    ) : null;

    return (
        <div
            id={String(message._id)}
            data-highlighted={highlighted ? "true" : "false"}
            className={cn(
                "group relative flex w-full gap-2.5 rounded-lg px-2 transition-colors hover:bg-muted/40",
                showHeader ? "mt-1.5 pb-1 pt-1.5" : "py-0.5",
                highlighted && DEEP_LINK_HIGHLIGHT_CLASS
            )}
        >
            <div className="w-8 shrink-0">
                {showHeader ? (
                    <ChatBubbleAvatar
                        sender={senderInfo ?? { username: senderName }}
                        showPresence={!isMine && Boolean(selectedConversation?.isGroup)}
                    />
                ) : (
                    <span className="block pt-0.5 text-right text-[10px] leading-5 text-muted-foreground opacity-0 group-hover:opacity-100">
                        {timeLabel}
                    </span>
                )}
            </div>
            <div className="relative flex min-w-0 max-w-2xl flex-1 flex-col items-start">
                {showHeader ? (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-[13px] font-semibold text-foreground">{senderName}</span>
                        <time
                            className="text-[11px] text-muted-foreground"
                            dateTime={new Date(message.createdAt).toISOString()}
                        >
                            {timeLabel}
                        </time>
                        {receipt}
                        {intentBadge}
                    </div>
                ) : intentBadge || receiptState === "sending" ? (
                    <div className="flex items-center gap-2">
                        {intentBadge}
                        {receiptState === "sending" ? receipt : null}
                    </div>
                ) : null}
                <div
                    className={cn(
                        "w-full text-foreground",
                        message.messageType !== "text" && "mt-1 max-w-sm"
                    )}
                >
                    {/* Reply preview (full: name + snippet) */}
                    {(message).repliedTo && getRepliedPreview()}

                    {/* Main content */}
                    {renderContent()}
                </div>

                {hasReactions && !message.isDeleted && (
                    <div className="mt-1 flex flex-wrap gap-1">
                        <AnimatePresence>
                            {Object.entries(groupedReactions).map(([emoji, users]) => {
                                const reactedByMe = users.some((u) => String(u) === String(currentUserId));
                                return (
                                    <motion.span
                                        key={emoji}
                                        initial={{ scale: 0, y: 6, opacity: 0 }}
                                        animate={{ scale: 1, y: 0, opacity: 1 }}
                                        exit={{ scale: 0, opacity: 0 }}
                                        transition={{ type: "spring", stiffness: 350, damping: 20 }}
                                        className={cn(
                                            "rounded-full border px-1.5 py-0.5 text-[11px]",
                                            reactedByMe
                                                ? "border-primary/30 bg-primary/10 text-primary"
                                                : "border-border bg-muted/50 text-foreground"
                                        )}
                                    >
                                        {emoji}
                                        {users.length > 1 && ` ${users.length}`}
                                    </motion.span>
                                );
                            })}
                        </AnimatePresence>
                    </div>
                )}

                {/* Reaction picker bar */}
                {showReactions && (
                    <ReactionBar
                        onSelect={(emoji: string) => {
                            onReact(message, emoji);

                            setShowReactions(false);
                        }}
                    />
                )}

                {suggestion ? <ConversationSuggestionCard suggestion={suggestion} /> : null}
            </div>

            {("isDeleted" in message ? !message.isDeleted : true) && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className="absolute right-2 top-1 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                            aria-label="Message actions"
                        >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="left" align="start">
                        <DropdownMenuItem onClick={() => setShowReactions(true)}>
                            <Smile className="w-4 h-4 mr-2" /> React
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onReply(message)}>
                            <MessageCircle className="w-4 h-4 mr-2" /> Reply
                        </DropdownMenuItem>
                        {isMine && (
                            <>
                                {message.messageType === "text" && (<DropdownMenuItem
                                    onClick={() =>
                                        setEditingMessage(message)

                                    }
                                >
                                    <Edit className="w-4 h-4 mr-2" /> Edit
                                </DropdownMenuItem>)}
                                <DropdownMenuItem
                                    onClick={() => onDelete(message._id)}
                                >
                                    <Trash2 className="w-4 h-4 mr-2 text-red-500" /> Delete
                                </DropdownMenuItem>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    );
};

export default ChatBubble;