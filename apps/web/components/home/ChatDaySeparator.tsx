interface ChatDaySeparatorProps {
    date: Date;
}

const ChatDaySeparator = ({ date }: ChatDaySeparatorProps) => {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    let label = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
    }).format(date);

    if (date.toDateString() === today.toDateString()) {
        label = "Today";
    } else if (date.toDateString() === yesterday.toDateString()) {
        label = "Yesterday";
    }

    return (
        <div className="my-2 flex items-center gap-3 px-2">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
            <span className="h-px flex-1 bg-border" />
        </div>
    );
};

export default ChatDaySeparator;