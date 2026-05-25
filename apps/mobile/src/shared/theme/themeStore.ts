import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ThemePreference = "light" | "dark" | "system";

type ThemeState = {
    theme: ThemePreference;
    setTheme: (theme: ThemePreference) => void;
};

export const useThemeStore = create<ThemeState>()(
    persist(
        (set) => ({
            theme: "system",
            setTheme: (theme) => set({ theme }),
        }),
        {
            name: "mobile-theme-preference",
            storage: createJSONStorage(() => AsyncStorage),
        }
    )
);
