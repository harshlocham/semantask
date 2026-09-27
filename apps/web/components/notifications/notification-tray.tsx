"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SocketEvents } from "@semantask/types";
import { getSocket } from "@/lib/socket/socketClient";
import { taskHref } from "@/lib/work-links";
import { useUser } from "@/context/UserContext";

const PREFS_KEY = "semantask.notifyPrefs";

type NotifyPrefs = {
    inApp: boolean;
};

type TrayItem = {
    id: string;
    kind: string;
    subject: string;
    text: string;
    entityId?: string | null;
    at: string;
};

function readPrefs(): NotifyPrefs {
    if (typeof window === "undefined") return { inApp: true };
    try {
        const raw = window.localStorage.getItem(PREFS_KEY);
        if (!raw) return { inApp: true };
        const parsed = JSON.parse(raw) as NotifyPrefs;
        return { inApp: parsed.inApp !== false };
    } catch {
        return { inApp: true };
    }
}

export function NotificationTray() {
    const { user } = useUser();
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<TrayItem[]>([]);
    const [prefs, setPrefs] = useState<NotifyPrefs>({ inApp: true });

    useEffect(() => {
        setPrefs(readPrefs());
        const socket = getSocket();
        const handler = (payload: {
            kind: string;
            subject: string;
            text: string;
            entityId?: string | null;
            dedupeKey?: string;
        }) => {
            if (!readPrefs().inApp) return;
            setItems((current) => [
                {
                    id: payload.dedupeKey || `${Date.now()}-${payload.subject}`,
                    kind: payload.kind,
                    subject: payload.subject,
                    text: payload.text,
                    entityId: payload.entityId,
                    at: new Date().toISOString(),
                },
                ...current,
            ].slice(0, 20));
        };
        socket.on(SocketEvents.USER_NOTIFICATION, handler);
        return () => {
            socket.off(SocketEvents.USER_NOTIFICATION, handler);
        };
    }, []);

    function toggleInApp() {
        const next = { inApp: !prefs.inApp };
        setPrefs(next);
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    }

    if (!user?._id) return null;

    return (
        <div className="relative" data-testid="notification-tray">
            <button
                type="button"
                className="relative rounded-md border border-input px-2 py-1 text-xs"
                data-testid="notification-tray-toggle"
                onClick={() => setOpen((value) => !value)}
            >
                Alerts
                {items.length > 0 ? (
                    <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                        {items.length}
                    </span>
                ) : null}
            </button>
            {open ? (
                <div className="absolute right-0 z-30 mt-2 w-80 rounded-md border border-border bg-background p-3 shadow-lg">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">Notifications</p>
                        <label className="flex items-center gap-1 text-xs text-muted-foreground">
                            <input
                                type="checkbox"
                                checked={prefs.inApp}
                                onChange={toggleInApp}
                                data-testid="notification-pref-in-app"
                            />
                            In-app
                        </label>
                    </div>
                    {items.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No notifications yet.</p>
                    ) : (
                        <ul className="max-h-72 space-y-2 overflow-y-auto text-sm">
                            {items.map((item) => (
                                <li key={item.id} className="rounded-md border border-border px-2 py-2">
                                    <p className="font-medium">{item.subject}</p>
                                    <p className="text-xs text-muted-foreground">{item.text}</p>
                                    {item.kind === "approval_required" ? (
                                        <Link
                                            href="/inbox/approvals"
                                            className="text-xs underline underline-offset-2"
                                            data-testid="notification-tray-approvals-link"
                                        >
                                            Open approvals
                                        </Link>
                                    ) : item.entityId ? (
                                        <Link
                                            href={taskHref(item.entityId)}
                                            className="text-xs underline underline-offset-2"
                                            data-testid="notification-tray-task-link"
                                        >
                                            Open
                                        </Link>
                                    ) : null}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            ) : null}
        </div>
    );
}
