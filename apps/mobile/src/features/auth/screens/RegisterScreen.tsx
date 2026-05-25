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

import api from "@/features/auth/api/client";
import type { AuthStackParamList } from "@/app/navigation/types";

type RegisterScreenProps = StackScreenProps<AuthStackParamList, "Register">;

export default function RegisterScreen({ navigation }: RegisterScreenProps) {
    const { height } = useWindowDimensions();
    const isCompact = height < 760;

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState("");
    const [errorMessage, setErrorMessage] = useState("");

    const canSubmit = name.trim().length > 0 && email.trim().length > 0 && password.trim().length >= 6;

    const handleSendOtp = async () => {
        if (submitting) {
            return;
        }

        const trimmedName = name.trim();
        const trimmedEmail = email.trim();
        const trimmedPassword = password.trim();

        if (!trimmedName || !trimmedEmail || !trimmedPassword) {
            setErrorMessage("All fields are required.");
            setMessage("");
            return;
        }

        if (trimmedPassword.length < 6) {
            setErrorMessage("Password must be at least 6 characters.");
            setMessage("");
            return;
        }

        setSubmitting(true);
        setErrorMessage("");
        setMessage("");

        try {
            await api.post("/auth/sendOtp", { email: trimmedEmail });
            setMessage("OTP sent. Check your email to continue registration.");
        } catch (e: any) {
            const serverMessage = e?.response?.data?.error;

            if (typeof serverMessage === "string" && serverMessage.length > 0) {
                setErrorMessage(serverMessage);
            } else {
                setErrorMessage("Could not send OTP right now. Please try again.");
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
                                    onPress={() => navigation.navigate("Login")}
                                >
                                    <Text className={`${isCompact ? "text-sm" : "text-base"} text-slate-400`}>
                                        Already have an account? <Text className="font-semibold text-slate-200">Login</Text>
                                    </Text>
                                </Pressable>

                                {/* <Pressable className={`${isCompact ? "h-10 w-10" : "h-12 w-12"} items-center justify-center rounded-xl border border-[#1a365d] bg-[#081a31]`}>
                                    <Text className={`${isCompact ? "text-lg" : "text-xl"} text-slate-100`}>☾</Text>
                                </Pressable> */}
                            </View>

                            <View className={`${isCompact ? "mt-4" : "mt-6"}`}>
                                <Text className={`${isCompact ? "text-3xl" : "text-4xl"} font-bold tracking-tight text-slate-50`}>Create your account</Text>
                                <Text className={`${isCompact ? "mt-2 text-base leading-6" : "mt-3 text-xl leading-7"} text-slate-300`}>
                                    Set up your account to start chatting instantly.
                                </Text>
                            </View>

                            <View className={`${isCompact ? "mt-5 gap-3" : "mt-7 gap-4"}`}>
                                <View className="gap-2">
                                    <Text className={`${isCompact ? "text-lg" : "text-xl"} font-semibold text-slate-100`}>Full Name</Text>
                                    <TextInput
                                        className={`${isCompact ? "h-12 text-base" : "h-14 text-lg"} rounded-2xl border border-[#17355f] bg-[#020c1c] px-4 text-slate-100`}
                                        placeholder="John Doe"
                                        placeholderTextColor="#6b7f98"
                                        value={name}
                                        onChangeText={setName}
                                        editable={!submitting}
                                        autoComplete="name"
                                    />
                                </View>

                                <View className="gap-2">
                                    <Text className={`${isCompact ? "text-lg" : "text-xl"} font-semibold text-slate-100`}>Email</Text>
                                    <TextInput
                                        className={`${isCompact ? "h-12 text-base" : "h-14 text-lg"} rounded-2xl border border-[#17355f] bg-[#020c1c] px-4 text-slate-100`}
                                        placeholder="you@example.com"
                                        placeholderTextColor="#6b7f98"
                                        value={email}
                                        onChangeText={setEmail}
                                        autoCapitalize="none"
                                        keyboardType="email-address"
                                        editable={!submitting}
                                        autoComplete="email"
                                    />
                                </View>

                                <View className="gap-2">
                                    <Text className={`${isCompact ? "text-lg" : "text-xl"} font-semibold text-slate-100`}>Password</Text>
                                    <TextInput
                                        className={`${isCompact ? "h-12 text-base" : "h-14 text-lg"} rounded-2xl border border-[#17355f] bg-[#020c1c] px-4 text-slate-100`}
                                        placeholder="At least 6 characters"
                                        placeholderTextColor="#6b7f98"
                                        value={password}
                                        onChangeText={setPassword}
                                        secureTextEntry
                                        editable={!submitting}
                                        autoComplete="new-password"
                                    />
                                </View>

                                {errorMessage ? <Text className="text-sm text-red-300">{errorMessage}</Text> : null}
                                {message ? <Text className="text-sm text-emerald-300">{message}</Text> : null}

                                <Pressable
                                    className={`${isCompact ? "mt-0 h-12" : "mt-1 h-14"} items-center justify-center rounded-2xl ${canSubmit && !submitting ? "bg-[#0b2445]" : "bg-[#0b2445]/40"}`}
                                    onPress={handleSendOtp}
                                    disabled={!canSubmit || submitting}
                                >
                                    {submitting ? (
                                        <ActivityIndicator color="#FFFFFF" />
                                    ) : (
                                        <Text className={`${isCompact ? "text-xl" : "text-2xl"} font-semibold text-slate-100`}>Send OTP</Text>
                                    )}
                                </Pressable>
                            </View>

                            <Text className={`${isCompact ? "mt-4 text-sm leading-5" : "mt-6 text-base leading-6"} text-slate-400`}>
                                We protect your account with email verification before first login.
                            </Text>
                        </View>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}