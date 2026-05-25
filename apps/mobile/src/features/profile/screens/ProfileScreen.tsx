import { StackScreenProps } from "@react-navigation/stack";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ProfileStackParamList } from "@/app/navigation/types";
import { useThemeContext } from "@/app/providers/ThemeProvider";
import { logout } from "@/features/auth/api/authService";
import { tokenStore } from "@/features/auth/api/tokenStore";
import { useAuthStore } from "@/features/auth/store/authStore";
import { useChatStore } from "@/features/chat/store/chatStore";
import { socketClient } from "@/lib/socket";

type ProfileScreenProps = StackScreenProps<ProfileStackParamList, "Profile">;

export default function ProfileScreen({ navigation }: ProfileScreenProps) {
    const { theme, resolvedTheme, setTheme } = useThemeContext();
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [isForceClearing, setIsForceClearing] = useState(false);

    const buttonClass = (value: "light" | "dark" | "system") =>
        theme === value
            ? "rounded-xl bg-slate-900 px-4 py-2"
            : "rounded-xl border border-slate-300 px-4 py-2";

    const buttonTextClass = (value: "light" | "dark" | "system") =>
        theme === value ? "text-white font-semibold" : "text-slate-700 font-semibold";

    const completeLocalReset = () => {
        useAuthStore.getState().logout();
        useChatStore.getState().setCurrentUserId(null);
        useChatStore.getState().resetChatSession();
        socketClient.disconnect();
    };

    const handleLogout = () => {
        Alert.alert("Log out", "Are you sure you want to log out?", [
            { text: "Cancel", style: "cancel" },
            {
                text: "Log out",
                style: "destructive",
                onPress: async () => {
                    setIsLoggingOut(true);
                    try {
                        await logout();
                        completeLocalReset();
                    } finally {
                        setIsLoggingOut(false);
                    }
                },
            },
        ]);
    };

    const handleForceClear = () => {
        Alert.alert(
            "Force clear session",
            "This removes secure tokens from device storage. Continue?",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Clear",
                    style: "destructive",
                    onPress: async () => {
                        setIsForceClearing(true);
                        try {
                            await tokenStore.clearTokens();
                            completeLocalReset();
                        } finally {
                            setIsForceClearing(false);
                        }
                    },
                },
            ]
        );
    };

    return (
        <SafeAreaView className="flex-1 bg-white dark:bg-black">
            <View className="flex-1 p-4 gap-4">
                <Text className="text-2xl font-bold text-slate-900 dark:text-slate-100">Profile</Text>
                <Text className="text-slate-600 dark:text-slate-300">Current theme: {theme}</Text>
                <Text className="text-slate-600 dark:text-slate-300">Resolved: {resolvedTheme}</Text>

                <View className="flex-row gap-2">
                    <Pressable className={buttonClass("light")} onPress={() => setTheme("light")}>
                        <Text className={buttonTextClass("light")}>Light</Text>
                    </Pressable>

                    <Pressable className={buttonClass("dark")} onPress={() => setTheme("dark")}>
                        <Text className={buttonTextClass("dark")}>Dark</Text>
                    </Pressable>

                    <Pressable className={buttonClass("system")} onPress={() => setTheme("system")}>
                        <Text className={buttonTextClass("system")}>System</Text>
                    </Pressable>
                </View>

                <Pressable
                    className="rounded-xl border border-slate-300 px-4 py-3"
                    onPress={() => navigation.navigate("Settings")}
                >
                    <Text className="text-slate-700 dark:text-slate-200 font-semibold">Open Settings</Text>
                </Pressable>

                <Pressable
                    className="rounded-xl bg-red-600 px-4 py-3"
                    onPress={handleLogout}
                    disabled={isLoggingOut || isForceClearing}
                >
                    <View className="flex-row items-center justify-center gap-2">
                        {isLoggingOut ? <ActivityIndicator color="#ffffff" /> : null}
                        <Text className="text-center font-semibold text-white">Log Out</Text>
                    </View>
                </Pressable>

                <Pressable
                    className="rounded-xl border border-red-300 px-4 py-3"
                    onPress={handleForceClear}
                    disabled={isLoggingOut || isForceClearing}
                >
                    <View className="flex-row items-center justify-center gap-2">
                        {isForceClearing ? <ActivityIndicator /> : null}
                        <Text className="text-center font-semibold text-red-600 dark:text-red-300">
                            Force Clear Secure Tokens
                        </Text>
                    </View>
                </Pressable>
            </View>
        </SafeAreaView>
    );
}