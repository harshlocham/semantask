import { StackScreenProps } from "@react-navigation/stack";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { RootStackParamList } from "@/app/navigation/types";

type CallScreenProps = StackScreenProps<RootStackParamList, "CallScreen">;

export default function CallScreen({ navigation, route }: CallScreenProps) {
    return (
        <SafeAreaView className="flex-1 bg-black">
            <View className="flex-1 p-6 justify-center items-center gap-4">
                <Text className="text-3xl font-bold text-white">Active Call</Text>
                <Text className="text-slate-300">Call ID: {route.params?.callId ?? "unknown"}</Text>
                <Pressable
                    className="rounded-xl bg-red-600 px-5 py-3"
                    onPress={() => navigation.goBack()}
                >
                    <Text className="text-white font-semibold">End Call</Text>
                </Pressable>
            </View>
        </SafeAreaView>
    );
}
