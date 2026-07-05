"use client";

import { useState } from "react";
import { ImageUpload } from "./ImageUpload";
import { Button } from "../ui/button";
import { Camera } from "lucide-react";
import toast from "react-hot-toast";
import UserAvatar from "./UserAvatar";
import { useUser } from "@/context/UserContext";
import { ClientUser } from "@semantask/types";
import { authenticatedFetch } from "@/lib/utils/api";
interface ProfilePictureUploadProps {
    onUpdate?: (imageUrl: string) => void;
    className?: string;
}

export const ProfilePictureUpload = ({ onUpdate, className }: ProfilePictureUploadProps) => {
    const [isUpdating, setIsUpdating] = useState(false);
    const [showUpload, setShowUpload] = useState(false);
    const { user, refreshUser } = useUser() as {
        user: ClientUser | null;
        refreshUser: () => Promise<ClientUser | null | undefined>;
    };

    const handleImageUpload = async (result: { url?: string; fileId?: string }) => {
        if (!result.url) return;

        setIsUpdating(true);
        try {
            const response = await authenticatedFetch("/api/updateImage", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ imageUrl: result.url }),
            });

            if (!response.ok) {
                throw new Error("Failed to update profile picture");
            }

            await refreshUser();

            toast.success("Profile picture updated successfully!");
            onUpdate?.(result.url);
            setShowUpload(false);
        } catch (error) {
            console.error("Error updating profile picture:", error);
            toast.error("Failed to update profile picture");
        } finally {
            setIsUpdating(false);
        }
    };


    return (
        <div className={`relative ${className}`}>
            <div className="relative group">
                {user && (
                    <UserAvatar
                        username={user.username}
                        profilePicture={user.profilePicture}
                        size={150}
                    />
                )}

                <Button
                    size="sm"
                    variant="secondary"
                    className="absolute bottom-0 right-0 rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => setShowUpload(!showUpload)}
                >
                    <Camera size={16} />
                </Button>
            </div>


            {showUpload && (
                <div className="mt-4 p-4 border rounded-lg bg-background">
                    <h3 className="text-sm font-medium mb-2">Update Profile Picture</h3>
                    <ImageUpload
                        onSuccess={handleImageUpload}
                        onProgress={(progress) => {
                            if (progress === 100) {
                                toast.success("Image uploaded successfully!");
                            }
                        }}
                        disabled={isUpdating}
                    />
                    {isUpdating && (
                        <p className="text-sm text-muted-foreground mt-2">
                            Updating profile picture...
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};
