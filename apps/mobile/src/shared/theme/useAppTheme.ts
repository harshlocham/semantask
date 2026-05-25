import { useColorScheme } from "react-native";

import { themes, type ThemeName } from "./theme";
import { useThemeStore } from "./themeStore";

export function useAppTheme() {
    const preference = useThemeStore((state) => state.theme);
    const systemTheme = useColorScheme();

    const resolvedTheme: ThemeName =
        preference === "system"
            ? systemTheme === "dark"
                ? "dark"
                : "light"
            : preference;

    return {
        preference,
        resolvedTheme,
        colors: themes[resolvedTheme],
    };
}
