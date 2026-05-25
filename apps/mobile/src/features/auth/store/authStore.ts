import { create } from "zustand";

type AuthState = {
    user: any | null;
    setUser: (user: any) => void;
    logout: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
    user: null,

    setUser: (user) => set({ user }),

    logout: () => set({ user: null }),
}));