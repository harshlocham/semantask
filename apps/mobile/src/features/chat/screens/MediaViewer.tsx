import { StackScreenProps } from "@react-navigation/stack";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { RootStackParamList } from "@/app/navigation/types";

type MediaViewerProps = StackScreenProps<RootStackParamList, "MediaViewer">;

export default function MediaViewer({ navigation, route }: MediaViewerProps) {
    return (
        <SafeAreaView className="flex-1 bg-black">
            <View className="flex-1 p-6 justify-center items-center gap-4">
                <Text className="text-white text-xl font-semibold">Media Viewer</Text>
                <Text className="text-slate-300">Type: {route.params.type ?? "image"}</Text>
                <Text className="text-slate-400 text-center">URI: {route.params.uri}</Text>
                <Pressable className="rounded-xl bg-slate-800 px-5 py-3" onPress={() => navigation.goBack()}>
                    <Text className="text-white font-semibold">Close</Text>
                </Pressable>
            </View>
        </SafeAreaView>
    );
}
