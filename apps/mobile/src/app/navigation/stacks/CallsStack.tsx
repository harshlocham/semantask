import { createStackNavigator } from "@react-navigation/stack";

import CallsList from "@/features/calls/screens/CallsList";
import CallHistoryDetail from "@/features/calls/screens/CallHistoryDetail";
import type { CallsStackParamList } from "@/app/navigation/types";

const Stack = createStackNavigator<CallsStackParamList>();

export default function CallsStack() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="CallsList" component={CallsList} />
            <Stack.Screen name="CallHistoryDetail" component={CallHistoryDetail} />
        </Stack.Navigator>
    );
}
