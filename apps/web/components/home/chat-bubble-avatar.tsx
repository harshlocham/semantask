import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { ClientUser } from "@semantask/types";

type ChatBubbleAvatarProps = {
    sender: Pick<ClientUser, "username"> & Partial<Pick<ClientUser, "profilePicture" | "isOnline">>;
    showPresence?: boolean;
};

function initialsFor(username: string | undefined) {
    const parts = (username ?? "").trim().split(/[\s._-]+/).filter(Boolean);
    const letters = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : (parts[0] ?? "U").slice(0, 2);
    return letters.toUpperCase();
}

const ChatBubbleAvatar = ({ sender, showPresence = false }: ChatBubbleAvatarProps) => {
    return (
        <Avatar className="relative size-8 overflow-visible">
            {showPresence && sender.isOnline ? (
                <span className="absolute -right-0.5 -bottom-0.5 z-10 h-2.5 w-2.5 rounded-full border-2 border-background bg-emerald-500" />
            ) : null}
            <AvatarImage src={sender.profilePicture} alt="" className="rounded-full object-cover" />
            <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                {initialsFor(sender.username)}
            </AvatarFallback>
        </Avatar>
    );
};
export default ChatBubbleAvatar;
