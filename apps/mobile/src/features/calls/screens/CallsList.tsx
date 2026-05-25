import { StackScreenProps } from "@react-navigation/stack";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { CallsStackParamList } from "@/app/navigation/types";

type CallsListProps = StackScreenProps<CallsStackParamList, "CallsList">;

export default function CallsList({ navigation }: CallsListProps) {
    return (
        <SafeAreaView className="flex-1 bg-white">
            <View className="flex-1 p-4 gap-3">
                <Text className="text-2xl font-bold text-slate-900">Calls</Text>

                <Pressable
                    className="rounded-xl bg-slate-900 px-4 py-3"
                    onPress={() => navigation.navigate("CallHistoryDetail", { callId: "call-001" })}
                >
                    <Text className="text-white font-semibold">Open Call History Detail</Text>
                </Pressable>
            </View>
        </SafeAreaView>
    );
}
