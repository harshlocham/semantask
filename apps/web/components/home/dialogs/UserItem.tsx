import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ComposeParticipant } from "@/lib/utils/api";
import { cn } from "@/lib/utils/utils";

type UserItemProps = {
    user: ComposeParticipant;
    selected: boolean;
    onClick: () => void;
};

export const UserItem = ({ user, selected, onClick }: UserItemProps) => {
    const label = user.username || user.email || "Person";

    return (
        <button
            type="button"
            data-person={user.id}
            aria-pressed={selected}
            onClick={onClick}
            className={cn(
                "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition hover:bg-accent",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected && "bg-accent"
            )}
        >
            <Avatar className="size-8">
                <AvatarImage src={user.profilePicture || ""} alt="" className="object-cover" />
                <AvatarFallback className="bg-muted text-xs">
                    {label.slice(0, 1).toUpperCase()}
                </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">{label}</span>
                {user.existingDirectConversationId ? (
                    <span className="block truncate text-xs text-muted-foreground">Already chatting</span>
                ) : null}
            </span>
            {selected ? <span className="sr-only">Selected</span> : null}
        </button>
    );
};
