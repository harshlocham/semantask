import { createStackNavigator } from "@react-navigation/stack";
import TabsNavigator from "./TabsNavigator";
import ChatSocketBridge from "@/features/chat/socket/ChatSocketBridge";
import CallSocketBridge from "@/features/calls/socket/CallSocketBridge";
import IncomingCallModal from "@/features/calls/components/IncomingCallModal";

import type { AppStackParamList } from "./types";

const Stack = createStackNavigator<AppStackParamList>();

export default function AppStack() {
    return (
        <>
            <ChatSocketBridge />
            <CallSocketBridge />
            <IncomingCallModal />
            <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="TabsNavigator" component={TabsNavigator} />
            </Stack.Navigator>
        </>
    );
}
