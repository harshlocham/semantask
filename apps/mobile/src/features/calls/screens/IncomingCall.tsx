import { StackScreenProps } from "@react-navigation/stack";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { RootStackParamList } from "@/app/navigation/types";

type IncomingCallProps = StackScreenProps<RootStackParamList, "IncomingCall">;

export default function IncomingCall({ navigation, route }: IncomingCallProps) {
    return (
        <SafeAreaView className="flex-1 bg-slate-950">
            <View className="flex-1 p-6 justify-center items-center gap-4">
                <Text className="text-3xl font-bold text-white">Incoming Call</Text>
                <Text className="text-slate-300">From: {route.params.fromUserId ?? "Unknown user"}</Text>
                <View className="flex-row gap-3">
                    <Pressable className="rounded-xl bg-emerald-600 px-5 py-3" onPress={() => navigation.replace("CallScreen", { callId: route.params.callId })}>
                        <Text className="text-white font-semibold">Accept</Text>
                    </Pressable>
                    <Pressable className="rounded-xl bg-red-600 px-5 py-3" onPress={() => navigation.goBack()}>
                        <Text className="text-white font-semibold">Decline</Text>
                    </Pressable>
                </View>
            </View>
        </SafeAreaView>
    );
}
