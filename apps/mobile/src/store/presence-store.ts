import { create } from "zustand";

type PresenceState = {
    onlineUsers: Record<string, true>;
    lastSeenByUser: Record<string, string>;
    setOnlineUser: (userId: string) => void;
    setOfflineUser: (userId: string, lastSeen?: string | Date) => void;
    setOnlineUsers: (userIds: string[]) => void;
    resetPresence: () => void;
};

const toIsoString = (value?: string | Date) => {
    if (!value) {
        return new Date().toISOString();
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

export const usePresenceStore = create<PresenceState>((set) => ({
    onlineUsers: {},
    lastSeenByUser: {},

    setOnlineUser: (userId) =>
        set((state) => {
            if (state.onlineUsers[userId]) {
                return {};
            }

            return {
                onlineUsers: {
                    ...state.onlineUsers,
                    [userId]: true,
                },
            };
        }),

    setOfflineUser: (userId, lastSeen) =>
        set((state) => {
            const nextOnlineUsers = { ...state.onlineUsers };
            delete nextOnlineUsers[userId];

            return {
                onlineUsers: nextOnlineUsers,
                lastSeenByUser: {
                    ...state.lastSeenByUser,
                    [userId]: toIsoString(lastSeen),
                },
            };
        }),

    setOnlineUsers: (userIds) =>
        set(() => {
            const nextOnlineUsers: Record<string, true> = {};

            for (const userId of new Set(userIds.filter(Boolean))) {
                nextOnlineUsers[userId] = true;
            }

            return {
                onlineUsers: nextOnlineUsers,
            };
        }),

    resetPresence: () =>
        set({
            onlineUsers: {},
            lastSeenByUser: {},
        }),
}));

export const presenceSelectors = {
    isOnline:
        (userId: string | null | undefined) =>
            (state: PresenceState) => Boolean(userId && state.onlineUsers[userId]),
    lastSeen:
        (userId: string | null | undefined) =>
            (state: PresenceState) => (userId ? state.lastSeenByUser[userId] ?? null : null),
};