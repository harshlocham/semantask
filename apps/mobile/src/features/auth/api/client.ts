import axios from "axios";

import { tokenStore } from "@/features/auth/api/tokenStore";
import { ENV } from "@/shared/config/env";

const api = axios.create({
    baseURL: `${ENV.API_URL}/api`,
});

api.interceptors.request.use(async (config) => {
    const accessToken = await tokenStore.getAccessToken();

    if (accessToken) {
        config.headers.Authorization = `Bearer ${accessToken}`;
    }

    return config;
});

api.interceptors.response.use(
    (res) => res,
    async (error) => {
        const original = error?.config;

        if (!original || original._retry) {
            return Promise.reject(error);
        }

        if (error.response?.status === 401) {
            original._retry = true;

            const refreshToken = await tokenStore.getRefreshToken();
            const deviceId = await tokenStore.getOrCreateDeviceId();

            if (!refreshToken) {
                await tokenStore.clearTokens();
                return Promise.reject(error);
            }

            try {
                const res = await axios.post(
                    `${ENV.API_URL}/api/auth/refresh`,
                    { refreshToken, deviceId },
                    {
                        headers: {
                            "x-device-id": deviceId,
                        },
                    }
                );

                const { accessToken, refreshToken: newRefresh } = res.data;

                await tokenStore.setTokens(accessToken, newRefresh);

                original.headers = original.headers || {};
                original.headers.Authorization = `Bearer ${accessToken}`;

                return api(original);
            } catch (refreshError) {
                await tokenStore.clearTokens();
                return Promise.reject(refreshError);
            }
        }

        return Promise.reject(error);
    }
);

export default api;
