"use client";

import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";
import { ImageIcon, MessageSquareDiff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import toast from "react-hot-toast";
import useChatStore from "@/store/chat-store";
import {
    createConversation,
    createOrganizationInvitation,
    searchComposeDirectory,
    type ComposeParticipant,
} from "@/lib/utils/api";
import { useEffect, useRef, useState } from "react";
import { UserItem } from "./UserItem";
import { upload } from "@imagekit/next";
import { ClientConversation, ClientUser } from "@semantask/types";
import { getImageKitUploadAuth } from "@/lib/utils/imagekit";
import { useUser } from "@/context/UserContext";
import { useActiveOrganizationId } from "@/hooks/useActiveOrganizationId";

type UserListDialogProps = {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    hideTrigger?: boolean;
};

const SEARCH_DEBOUNCE_MS = 200;

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
}

function asClientUser(person: ComposeParticipant): ClientUser {
    return {
        _id: person.id,
        username: person.username,
        email: person.email ?? "",
        isOnline: false,
        profilePicture: person.profilePicture ?? undefined,
        role: "user",
        status: "active",
        lastSeen: "",
        isVerified: false,
        conversations: [],
        createdAt: "",
        updatedAt: "",
    };
}

const UserListDialog = ({
    open: openProp,
    onOpenChange,
    hideTrigger = false,
}: UserListDialogProps) => {
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
    const open = openProp ?? uncontrolledOpen;
    const setOpen = onOpenChange ?? setUncontrolledOpen;
    const [query, setQuery] = useState("");
    const [people, setPeople] = useState<ComposeParticipant[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [invite, setInvite] = useState<{ email: string } | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<ComposeParticipant[]>([]);
    const [groupName, setGroupName] = useState("");
    const [selectedImage, setSelectedImage] = useState<File | null>(null);
    const [renderedImage, setRenderedImage] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const [invitePending, setInvitePending] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    const listRef = useRef<HTMLUListElement>(null);
    const setSelectedConversation = useChatStore((s) => s.setSelectedConversation);
    const { user: me } = useUser();
    const organizationId = useActiveOrganizationId();
    const trimmedQuery = query.trim();

    useEffect(() => {
        if (open) return;
        setQuery("");
        setPeople([]);
        setNextCursor(null);
        setInvite(null);
        setError(null);
        setSelected([]);
        setGroupName("");
        setSelectedImage(null);
    }, [open]);

    useEffect(() => {
        if (!open) return;

        const controller = new AbortController();
        const delay = trimmedQuery ? SEARCH_DEBOUNCE_MS : 0;
        const handle = window.setTimeout(() => {
            setLoading(true);
            setError(null);
            void searchComposeDirectory({
                q: trimmedQuery || undefined,
                signal: controller.signal,
            })
                .then((data) => {
                    if (controller.signal.aborted) return;
                    setPeople(trimmedQuery ? data.results : data.suggestions);
                    setNextCursor(data.nextCursor);
                    setInvite(trimmedQuery ? data.invite : null);
                })
                .catch((fetchError: unknown) => {
                    if (controller.signal.aborted || isAbortError(fetchError)) return;
                    setPeople([]);
                    setNextCursor(null);
                    setInvite(null);
                    setError("Couldn't load people");
                })
                .finally(() => {
                    if (!controller.signal.aborted) setLoading(false);
                });
        }, delay);

        return () => {
            controller.abort();
            window.clearTimeout(handle);
        };
    }, [open, trimmedQuery, reloadKey]);

    useEffect(() => {
        if (!selectedImage) return;
        const reader = new FileReader();
        reader.onload = (event) => setRenderedImage(String(event.target?.result ?? ""));
        reader.readAsDataURL(selectedImage);
        return () => {
            reader.onload = null;
        };
    }, [selectedImage]);

    useEffect(() => {
        if (!selectedImage) setRenderedImage("");
    }, [selectedImage]);

    const uploadToImageKit = async (file: File) => {
        const auth = await getImageKitUploadAuth();
        return upload({
            file,
            fileName: file.name,
            publicKey: auth.publicKey,
            signature: auth.signature,
            token: auth.token,
            expire: auth.expire,
            folder: "chat-group-images",
        });
    };

    const togglePerson = (person: ComposeParticipant) => {
        setSelected((prev) =>
            prev.some((item) => item.id === person.id)
                ? prev.filter((item) => item.id !== person.id)
                : [...prev, person]
        );
    };

    const onPeopleKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
        const buttons = Array.from(
            listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-person]") ?? []
        );
        if (buttons.length === 0) return;
        const index = buttons.findIndex((button) => button === document.activeElement);
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const nextIndex = event.key === "ArrowDown"
            ? (index < 0 ? 0 : Math.min(index + 1, buttons.length - 1))
            : (index <= 0 ? 0 : index - 1);
        buttons[nextIndex]?.focus();
    };

    const loadMore = async () => {
        if (!nextCursor || loadingMore) return;
        setLoadingMore(true);
        try {
            const data = await searchComposeDirectory({
                q: trimmedQuery || undefined,
                cursor: nextCursor,
            });
            const page = trimmedQuery ? data.results : data.suggestions;
            setPeople((prev) => {
                const seen = new Set(prev.map((person) => person.id));
                return [...prev, ...page.filter((person) => !seen.has(person.id))];
            });
            setNextCursor(data.nextCursor);
        } catch (fetchError: unknown) {
            if (!isAbortError(fetchError)) {
                setError("Couldn't load people");
            }
        } finally {
            setLoadingMore(false);
        }
    };

    const handleInvite = async () => {
        if (!invite || !organizationId) return;
        setInvitePending(true);
        try {
            await createOrganizationInvitation(organizationId, { email: invite.email });
            toast.success(`Invite sent to ${invite.email}`);
        } catch {
            toast.error("Failed to send invite");
        } finally {
            setInvitePending(false);
        }
    };

    const handleCreateConversation = async () => {
        if (!me?._id || selected.length === 0) return;
        const isGroup = selected.length > 1;
        if (isGroup && !groupName.trim()) return;
        setIsCreating(true);

        try {
            let imageUrl: string | undefined;
            if (isGroup && selectedImage) {
                const uploaded = await uploadToImageKit(selectedImage);
                imageUrl = uploaded.url;
            }

            const conversationId = await createConversation({
                participants: [...selected.map((person) => person.id), String(me._id)],
                isGroup,
                admin: isGroup ? String(me._id) : undefined,
                groupName: isGroup ? groupName.trim() : undefined,
                image: isGroup ? imageUrl : undefined,
            });

            const matchedUsers = selected.map(asClientUser);
            const otherUser = matchedUsers[0];
            const conversationName = isGroup
                ? groupName.trim()
                : (otherUser?.username || otherUser?.email || "");

            const newConversation: ClientConversation = {
                _id: conversationId,
                participants: [...matchedUsers, me],
                isGroup,
                image: isGroup ? imageUrl : otherUser?.profilePicture,
                name: conversationName,
                groupName: isGroup ? groupName.trim() : undefined,
                admin: String(me._id),
                type: isGroup ? "group" : "direct",
                createdAt: String(new Date()),
                updatedAt: String(new Date()),
            };

            setSelectedConversation(newConversation);
            setOpen(false);
            toast.success("Conversation created successfully");
        } catch {
            toast.error("Failed to create conversation");
        } finally {
            setIsCreating(false);
        }
    };

    const showRecentLabel = !trimmedQuery && (loading || people.length > 0);
    const statusText = loading
        ? "Loading people"
        : error
            ? error
            : trimmedQuery
                ? `${people.length} results`
                : `${people.length} recent people`;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            {hideTrigger ? null : (
                <DialogTrigger>
                    <MessageSquareDiff size={20} />
                </DialogTrigger>
            )}
            <DialogContent className="sm:max-w-106.25 bg-[hsl(var(--card))] shadow-xl rounded-xl">
                <DialogHeader>
                    <DialogTitle>New conversation</DialogTitle>
                    <DialogDescription>Search people in this workspace.</DialogDescription>
                </DialogHeader>

                <Input
                    role="searchbox"
                    aria-label="Search people"
                    placeholder="Search people..."
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key !== "ArrowDown") return;
                        event.preventDefault();
                        listRef.current?.querySelector<HTMLButtonElement>("button[data-person]")?.focus();
                    }}
                />

                <p className="sr-only" aria-live="polite">{statusText}</p>

                {renderedImage ? (
                    <div className="relative mx-auto h-16 w-16">
                        <Image src={renderedImage} fill alt="Group" className="rounded-full object-cover" />
                    </div>
                ) : null}

                {selected.length > 1 ? (
                    <section aria-labelledby="new-group-heading" className="flex flex-col gap-2">
                        <h2 id="new-group-heading" className="text-sm font-medium text-foreground">
                            New group
                        </h2>
                        <ul className="flex flex-wrap gap-2">
                            {selected.map((person) => (
                                <li
                                    key={person.id}
                                    className="rounded-full bg-accent px-2 py-1 text-xs text-foreground"
                                >
                                    {person.username || person.email}
                                </li>
                            ))}
                        </ul>
                        <Input
                            value={groupName}
                            onChange={(event) => setGroupName(event.target.value)}
                            placeholder="Group name"
                            aria-label="Group name"
                        />
                        <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            id="group-image-input"
                            onChange={(event) => setSelectedImage(event.target.files?.[0] || null)}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            className="flex gap-2"
                            onClick={() => document.getElementById("group-image-input")?.click()}
                        >
                            <ImageIcon size={20} />
                            Upload Group Image
                        </Button>
                    </section>
                ) : null}

                {showRecentLabel ? (
                    <p className="text-xs font-medium text-muted-foreground">Recent</p>
                ) : null}

                {error ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-3">
                        <p className="text-sm text-muted-foreground">{error}</p>
                        <Button type="button" variant="outline" onClick={() => setReloadKey((key) => key + 1)}>
                            Try again
                        </Button>
                    </div>
                ) : null}

                <ul
                    ref={listRef}
                    aria-label="People"
                    className="flex max-h-60 flex-col gap-1 overflow-auto"
                    onKeyDown={onPeopleKeyDown}
                >
                    {people.map((person) => (
                        <li key={person.id}>
                            <UserItem
                                user={person}
                                selected={selected.some((item) => item.id === person.id)}
                                onClick={() => togglePerson(person)}
                            />
                        </li>
                    ))}
                </ul>

                {!loading && !error && people.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        {trimmedQuery ? "No person found" : "No recent people"}
                    </p>
                ) : null}

                {invite ? (
                    organizationId ? (
                        <Button
                            type="button"
                            variant="outline"
                            disabled={invitePending}
                            onClick={() => void handleInvite()}
                        >
                            Invite {invite.email}
                        </Button>
                    ) : (
                        <Link
                            href="/organizations"
                            className="text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            Invite {invite.email}
                        </Link>
                    )
                ) : null}

                {nextCursor ? (
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={loadingMore}
                        onClick={() => void loadMore()}
                    >
                        {loadingMore ? "Loading…" : "Load more"}
                    </Button>
                ) : null}

                <div className="flex justify-between">
                    <DialogClose asChild>
                        <Button type="button" variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button
                        type="button"
                        onClick={() => void handleCreateConversation()}
                        disabled={
                            selected.length === 0
                            || !me
                            || (selected.length > 1 && !groupName.trim())
                            || isCreating
                        }
                    >
                        {isCreating ? (
                            <div className="h-5 w-5 animate-spin rounded-full border-t-2 border-b-2" />
                        ) : (
                            "Create"
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default UserListDialog;
