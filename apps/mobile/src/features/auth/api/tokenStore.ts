import * as SecureStore from "expo-secure-store";

const ACCESS = "accessToken";
const REFRESH = "refreshToken";
const DEVICE = "deviceId";

function generateDeviceId() {
    return `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const tokenStore = {
    async setTokens(accessToken: string, refreshToken: string) {
        await SecureStore.setItemAsync(ACCESS, accessToken);
        await SecureStore.setItemAsync(REFRESH, refreshToken);
    },
    async getAccessToken() {
        return await SecureStore.getItemAsync(ACCESS);
    },
    async getRefreshToken() {
        return await SecureStore.getItemAsync(REFRESH);
    },
    async clearTokens() {
        await SecureStore.deleteItemAsync(ACCESS);
        await SecureStore.deleteItemAsync(REFRESH);
    },
    async getOrCreateDeviceId() {
        const existing = await SecureStore.getItemAsync(DEVICE);
        if (existing) {
            return existing;
        }

        const created = generateDeviceId();
        await SecureStore.setItemAsync(DEVICE, created);
        return created;
    },
}