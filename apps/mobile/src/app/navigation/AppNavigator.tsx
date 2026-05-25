import { NavigationContainer } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import { ActivityIndicator, View } from "react-native";

import { ThemeProvider } from "@/app/providers/ThemeProvider";
import { useAuthBootstrap } from "@/features/auth/hooks/useAuthBootstrap";
import CallScreen from "@/features/calls/screens/CallScreen";
import IncomingCall from "@/features/calls/screens/IncomingCall";
import MediaViewer from "@/features/chat/screens/MediaViewer";
import { navigationRef } from "./navigationRef";
import AuthStack from "./AuthStack";
import AppStack from "./AppStack";
import type { RootStackParamList } from "./types";

const RootStack = createStackNavigator<RootStackParamList>();

export default function AppNavigator() {
    const { loading, isAuthenticated } = useAuthBootstrap();

    if (loading) {
        return (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                <ActivityIndicator size="large" />
            </View>
        );
    }

    return (
        <ThemeProvider>
            <NavigationContainer ref={navigationRef}>
                <RootStack.Navigator screenOptions={{ headerShown: false }}>
                    {isAuthenticated ? (
                        <RootStack.Screen name="AppStack" component={AppStack} />
                    ) : (
                        <RootStack.Screen name="AuthStack" component={AuthStack} />
                    )}

                    <RootStack.Screen
                        name="CallScreen"
                        component={CallScreen}
                        options={{ presentation: "modal" }}
                    />
                    <RootStack.Screen
                        name="IncomingCall"
                        component={IncomingCall}
                        options={{ presentation: "modal" }}
                    />
                    <RootStack.Screen
                        name="MediaViewer"
                        component={MediaViewer}
                        options={{ presentation: "modal" }}
                    />
                </RootStack.Navigator>
            </NavigationContainer>
        </ThemeProvider>
    );
}
