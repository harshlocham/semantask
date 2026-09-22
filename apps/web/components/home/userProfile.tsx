'use client'
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import UserAvatar from "./UserAvatar";
import { ProfilePictureUpload } from "./ProfilePictureUpload"
import { useUser } from "@/context/UserContext";
const UserProfile = () => {
    const { user } = useUser();

    //console.log(user)
    return (
        <Dialog >
            <DialogTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    className="size-12 shrink-0 rounded-full p-0 hover:bg-accent/50"
                    aria-label="Open profile settings"
                >
                    <UserAvatar
                        username={user?.username}
                        profilePicture={user?.profilePicture}
                        size={48}
                    />
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] bg-[hsl(var(--card))] shadow-xl rounded-xl">
                <DialogHeader>
                    <DialogTitle>Change your Profile picture</DialogTitle>
                    <DialogDescription>
                        Upload a new profile picture for your account.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex justify-center py-4">
                    <ProfilePictureUpload onUpdate={() => { }} />
                </div>

                <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline">Close</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default UserProfile