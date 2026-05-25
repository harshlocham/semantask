export type ThemeName = "light" | "dark";

export type ThemeColors = {
    background: string;
    text: string;
    primary: string;
    secondary: string;
};

export const themes: Record<ThemeName, ThemeColors> = {
    light: {
        background: "#ffffff",
        text: "#000000",
        primary: "#0f172a",
        secondary: "#64748b",
    },
    dark: {
        background: "#000000",
        text: "#ffffff",
        primary: "#38bdf8",
        secondary: "#94a3b8",
    },
};
