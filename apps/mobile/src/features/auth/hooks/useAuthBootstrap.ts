import { useEffect, useState } from "react";
import { tokenStore } from "@/features/auth/api/tokenStore";
import { useAuthStore } from "@/features/auth/store/authStore";
import { useChatStore } from "@/features/chat/store/chatStore";
import api from "@/features/auth/api/client";

const getUserId = (user: unknown) => {
    if (!user || typeof user !== "object") {
        return null;
    }

    const value = user as { id?: unknown; _id?: unknown };

    if (typeof value.id === "string") {
        return value.id;
    }

    if (typeof value._id === "string") {
        return value._id;
    }

    return null;
};

export function useAuthBootstrap() {
    const [loading, setLoading] = useState(true);
    const setUser = useAuthStore((s) => s.setUser);
    const user = useAuthStore((s) => s.user);
    const setCurrentUserId = useChatStore((s) => s.setCurrentUserId);
    const resetChatSession = useChatStore((s) => s.resetChatSession);

    useEffect(() => {
        (async () => {
            try {
                const token = await tokenStore.getAccessToken();

                if (token) {
                    const res = await api.get("/me");
                    setUser(res.data);
                    setCurrentUserId(getUserId(res.data));
                } else {
                    resetChatSession();
                }
            } catch (e) {
                console.log("Bootstrap failed", e);
                await tokenStore.clearTokens();
                setUser(null);
                setCurrentUserId(null);
                resetChatSession();
            } finally {
                setLoading(false);
            }
        })();
    }, [resetChatSession, setCurrentUserId, setUser]);

    return {
        loading,
        isAuthenticated: !!user,
    };
}