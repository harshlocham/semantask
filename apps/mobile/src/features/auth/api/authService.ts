import api from "@/features/auth/api/client";
import { tokenStore } from "@/features/auth/api/tokenStore";
import { useChatStore } from "@/features/chat/store/chatStore";

export async function login(email: string, password: string) {
    const deviceId = await tokenStore.getOrCreateDeviceId();
    const res = await api.post(
        "/auth/login",
        { email: email.trim(), password, deviceId },
        {
            headers: {
                "x-device-id": deviceId,
            },
        }
    );

    const payload = res.data ?? {};
    const accessToken = payload.accessToken;
    const refreshToken = payload.refreshToken;

    // Some server responses wrap user under `response.user` instead of top-level `user`.
    let user = payload.user ?? payload?.response?.user ?? null;

    await tokenStore.setTokens(accessToken, refreshToken);

    // Fallback to /me so app auth state still updates even when login payload shape changes.
    if (!user) {
        const me = await api.get("/me");
        user = me.data;
    }

    return user;
}

export async function logout() {
    try {
        const refreshToken = await tokenStore.getRefreshToken();
        const deviceId = await tokenStore.getOrCreateDeviceId();

        if (refreshToken) {
            await api.post(
                "/auth/logout",
                {
                    refreshToken,
                    logoutFromAllDevices: false,
                },
                {
                    headers: {
                        "x-device-id": deviceId,
                    },
                }
            );
        }
    } catch (e) {
        console.log("Logout API failed (safe to ignore)", e);
    } finally {
        await tokenStore.clearTokens();
        useChatStore.getState().resetChatSession();
    }
}