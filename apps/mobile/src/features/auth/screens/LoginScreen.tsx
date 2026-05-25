import { StackScreenProps } from "@react-navigation/stack";
import { useState } from "react";
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { login } from "@/features/auth/api/authService";
import { useAuthStore } from "@/features/auth/store/authStore";
import { useChatStore } from "@/features/chat/store/chatStore";
import type { AuthStackParamList } from "@/app/navigation/types";

type LoginScreenProps = StackScreenProps<AuthStackParamList, "Login">;

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

export default function LoginScreen({ navigation }: LoginScreenProps) {
    const { height } = useWindowDimensions();
    const isCompact = height < 760;

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const setUser = useAuthStore.getState().setUser;
    const setCurrentUserId = useChatStore((s) => s.setCurrentUserId);
    const resetChatSession = useChatStore((s) => s.resetChatSession);

    const handleLogin = async () => {
        if (submitting) return;

        const trimmedEmail = email.trim();
        if (!trimmedEmail || !password) {
            setErrorMessage("Email and password are required.");
            return;
        }

        setSubmitting(true);
        setErrorMessage("");

        try {
            const user = await login(trimmedEmail, password);
            resetChatSession();
            setUser(user);
            setCurrentUserId(getUserId(user));
        } catch (e: any) {
            const status = e?.response?.status;
            const serverMessage = e?.response?.data?.error;

            if (status === 401) {
                setErrorMessage("Invalid email or password.");
            } else if (status === 403) {
                setErrorMessage("Your account is not active.");
            } else if (typeof serverMessage === "string" && serverMessage.length > 0) {
                setErrorMessage(serverMessage);
            } else {
                setErrorMessage("Login failed. Please try again.");
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <SafeAreaView className="flex-1 bg-[#020817]">
            <View className="absolute inset-0">
                <View className="absolute -top-20 left-0 right-0 h-64 bg-cyan-400/10" />
                <View className="absolute -bottom-20 left-8 right-8 h-56 rounded-full bg-blue-500/10" />
            </View>

            <KeyboardAvoidingView
                className="flex-1"
                behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
                <ScrollView
                    className="flex-1"
                    contentContainerStyle={{
                        flexGrow: 1,
                        justifyContent: "center",
                        paddingVertical: isCompact ? 8 : 16,
                    }}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    <View className="px-4">
                        <View className={`w-full self-center max-w-[430px] rounded-3xl border border-[#163259] bg-[#031224]/95 ${isCompact ? "p-4" : "p-5"}`}>
                            <View className="flex-row items-center justify-between">
                                <Pressable
                                    className={`rounded-xl border border-[#1a365d] bg-[#081a31] ${isCompact ? "px-3 py-2" : "px-4 py-2"}`}
                                    onPress={() => navigation.navigate("Register")}
                                >
                                    <Text className={`${isCompact ? "text-sm" : "text-base"} text-slate-400`}>
                                        New here? <Text className="font-semibold text-slate-200">Create account</Text>
                                    </Text>
                                </Pressable>

                                {/* <Pressable className={`${isCompact ? "h-10 w-10" : "h-12 w-12"} items-center justify-center rounded-xl border border-[#1a365d] bg-[#081a31]`}>
                                    <Text className={`${isCompact ? "text-lg" : "text-xl"} text-slate-100`}>☾</Text>
                                </Pressable> */}
                            </View>

                            <View className={`${isCompact ? "mt-4" : "mt-6"}`}>
                                <Text className={`${isCompact ? "text-3xl" : "text-4xl"} font-bold tracking-tight text-slate-50`}>Welcome back</Text>
                                <Text className={`${isCompact ? "mt-2 text-base leading-6" : "mt-3 text-xl leading-7"} text-slate-300`}>
                                    Sign in to continue your chats and realtime updates.
                                </Text>
                            </View>

                            <View className={`${isCompact ? "mt-5 gap-3" : "mt-7 gap-4"}`}>
                                <View className="gap-2">
                                    <Text className={`${isCompact ? "text-lg" : "text-xl"} font-semibold text-slate-100`}>Email</Text>
                                    <TextInput
                                        className={`${isCompact ? "h-12 text-base" : "h-14 text-lg"} rounded-2xl border border-[#17355f] bg-[#020c1c] px-4 text-slate-100`}
                                        placeholder="you@example.com"
                                        placeholderTextColor="#6b7f98"
                                        autoCapitalize="none"
                                        keyboardType="email-address"
                                        value={email}
                                        onChangeText={setEmail}
                                        editable={!submitting}
                                    />
                                </View>

                                <View className="gap-2">
                                    <View className="flex-row items-center justify-between">
                                        <Text className={`${isCompact ? "text-lg" : "text-xl"} font-semibold text-slate-100`}>Password</Text>
                                        <Text className={`${isCompact ? "text-sm" : "text-base"} font-medium text-slate-400`}>Keep it secure</Text>
                                    </View>
                                    <TextInput
                                        className={`${isCompact ? "h-12 text-base" : "h-14 text-lg"} rounded-2xl border border-[#17355f] bg-[#020c1c] px-4 text-slate-100`}
                                        placeholder=""
                                        placeholderTextColor="#6b7f98"
                                        secureTextEntry
                                        value={password}
                                        onChangeText={setPassword}
                                        editable={!submitting}
                                    />
                                </View>

                                {errorMessage ? (
                                    <Text className="text-sm text-red-300">{errorMessage}</Text>
                                ) : null}

                                <Pressable
                                    className={`${isCompact ? "mt-0 h-12" : "mt-1 h-14"} items-center justify-center rounded-2xl ${submitting ? "bg-[#0b2445]/40" : "bg-[#0b2445]"}`}
                                    onPress={handleLogin}
                                    disabled={submitting}
                                >
                                    {submitting ? (
                                        <ActivityIndicator color="#FFFFFF" />
                                    ) : (
                                        <Text className={`${isCompact ? "text-xl" : "text-2xl"} font-semibold text-slate-100`}>Login</Text>
                                    )}
                                </Pressable>

                                <View className="mt-1 flex-row items-center">
                                    <View className="h-px flex-1 bg-[#163259]" />
                                    <Text className={`mx-4 ${isCompact ? "text-base" : "text-xl"} font-semibold tracking-[0.2em] text-slate-400`}>OR</Text>
                                    <View className="h-px flex-1 bg-[#163259]" />
                                </View>

                                <Pressable className={`${isCompact ? "h-12" : "h-14"} items-center justify-center rounded-2xl border border-[#17355f] bg-[#041529]`}>
                                    <Text className={`${isCompact ? "text-xl" : "text-2xl"} font-semibold text-slate-100`}>Continue with Google</Text>
                                </Pressable>
                            </View>
                        </View>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}