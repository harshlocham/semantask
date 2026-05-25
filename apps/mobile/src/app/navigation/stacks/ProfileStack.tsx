import { createStackNavigator } from "@react-navigation/stack";

import ProfileScreen from "@/features/profile/screens/ProfileScreen";
import SettingsScreen from "@/features/profile/screens/SettingsScreen";
import type { ProfileStackParamList } from "@/app/navigation/types";

const Stack = createStackNavigator<ProfileStackParamList>();

export default function ProfileStack() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
        </Stack.Navigator>
    );
}
