import { StackScreenProps } from "@react-navigation/stack";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { CallsStackParamList } from "@/app/navigation/types";

type CallHistoryDetailProps = StackScreenProps<CallsStackParamList, "CallHistoryDetail">;

export default function CallHistoryDetail({ route }: CallHistoryDetailProps) {
    return (
        <SafeAreaView className="flex-1 bg-white">
            <View className="flex-1 p-4 gap-2">
                <Text className="text-2xl font-bold text-slate-900">Call History Detail</Text>
                <Text className="text-slate-600">Call ID: {route.params.callId}</Text>
            </View>
        </SafeAreaView>
    );
}
