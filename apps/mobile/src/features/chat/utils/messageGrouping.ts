import type { ChatMessage } from "@/features/chat/store/chatStore";

export type GroupedChatMessage = {
    type: "message";
    key: string;
    message: ChatMessage;
    isMine: boolean;
    showAvatar: boolean;
    showSenderName: boolean;
    showTimestamp: boolean;
    timestampLabel: string;
    isSystem: boolean;
    compactSpacing: boolean;
};

export type ChatDateSeparator = {
    type: "separator";
    key: string;
    label: string;
};

export type GroupedChatRow = GroupedChatMessage | ChatDateSeparator;

function isSameDay(left?: string, right?: string) {
    if (!left || !right) {
        return false;
    }

    const leftDate = new Date(left);
    const rightDate = new Date(right);

    if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) {
        return false;
    }

    return leftDate.toDateString() === rightDate.toDateString();
}

function formatTimestamp(dateValue: string, showDate: boolean) {
    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    const timeText = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
    }).format(date);

    if (!showDate) {
        return timeText;
    }

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
        return `Today, ${timeText}`;
    }

    if (date.toDateString() === yesterday.toDateString()) {
        return `Yesterday, ${timeText}`;
    }

    const dateText = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
    }).format(date);

    return `${dateText}, ${timeText}`;
}

function formatDayLabel(dateValue: string) {
    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
        return "Today";
    }

    if (date.toDateString() === yesterday.toDateString()) {
        return "Yesterday";
    }

    return new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(date);
}

export function buildGroupedChatMessages(messages: ChatMessage[], currentUserId: string | null) {
    const rows: GroupedChatRow[] = [];

    messages.forEach((message, index) => {
        const nextOlderMessage = messages[index + 1];
        const isSystem = message.messageType === "system";
        const isMine = Boolean(currentUserId && message.sender._id === currentUserId);
        const isSameSenderAndDayAsOlder =
            Boolean(nextOlderMessage) &&
            !isSystem &&
            nextOlderMessage.sender._id === message.sender._id &&
            isSameDay(message.createdAt, nextOlderMessage.createdAt);

        const showAvatar = !isSystem && !isMine && !isSameSenderAndDayAsOlder;
        const showSenderName = showAvatar;
        const showTimestamp = isSystem || !isSameSenderAndDayAsOlder || !nextOlderMessage;
        const showDate = !nextOlderMessage || !isSameDay(message.createdAt, nextOlderMessage.createdAt);

        rows.push({
            type: "message",
            key: message._id,
            message,
            isMine,
            showAvatar,
            showSenderName,
            showTimestamp,
            timestampLabel: formatTimestamp(message.updatedAt || message.createdAt, showDate),
            isSystem,
            compactSpacing: isSameSenderAndDayAsOlder,
        } satisfies GroupedChatMessage);

        if (nextOlderMessage && !isSameDay(message.createdAt, nextOlderMessage.createdAt)) {
            rows.push({
                type: "separator",
                key: `separator-${message._id}`,
                label: formatDayLabel(message.createdAt),
            } satisfies ChatDateSeparator);
        }
    });

    return rows;
}