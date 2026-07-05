import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ClientUser } from "@semantask/types";

interface Props {
    user: ClientUser;
    selected: boolean;
    onClick: () => void;
}

export const UserItem = ({ user, selected, onClick }: Props) => (
    <div
        onClick={onClick}
        className={`flex gap-3 items-center p-2 rounded cursor-pointer transition-all hover:bg-[hsl(var(--gray-secondary))] ${selected ? "bg-[hsl(var(--green-primary))]" : ""
            }`}
    >
        <Avatar>
            {user.isOnline && (
                <div className="absolute top-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-foreground" />
            )}
            <AvatarImage src={user.profilePicture || ""} className="object-cover rounded-full" />
            <AvatarFallback className="bg-[hsl(var(--gray-tertiary))]" />
        </Avatar>
        <p className="text-md font-medium">{user.username || user.email.split("@")[0]}</p>
    </div>
);
