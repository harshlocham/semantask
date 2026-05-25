import { createContext, useContext, type ReactNode } from "react";
import { View } from "react-native";

import { useAppTheme } from "@/shared/theme/useAppTheme";
import { useThemeStore, type ThemePreference } from "@/shared/theme/themeStore";
import type { ThemeColors } from "@/shared/theme/theme";

type ThemeContextValue = {
    theme: ThemePreference;
    resolvedTheme: "light" | "dark";
    colors: ThemeColors;
    setTheme: (theme: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
    const { preference, resolvedTheme, colors } = useAppTheme();
    const setTheme = useThemeStore((state) => state.setTheme);

    return (
        <ThemeContext.Provider
            value={{
                theme: preference,
                resolvedTheme,
                colors,
                setTheme,
            }}
        >
            <View
                className={resolvedTheme === "dark" ? "dark flex-1" : "flex-1"}
                style={{ backgroundColor: colors.background }}
            >
                {children}
            </View>
        </ThemeContext.Provider>
    );
}

export function useThemeContext() {
    const context = useContext(ThemeContext);

    if (!context) {
        throw new Error("useThemeContext must be used within ThemeProvider");
    }

    return context;
}
