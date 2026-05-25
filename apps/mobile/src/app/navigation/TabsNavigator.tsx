import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { getFocusedRouteNameFromRoute } from "@react-navigation/native";
import type { TabsParamList } from "./types";
import ChatsStack from "./stacks/ChatsStack";
import CallsStack from "./stacks/CallsStack";
import ProfileStack from "./stacks/ProfileStack";
import { Ionicons } from "@expo/vector-icons";

const Tab = createBottomTabNavigator<TabsParamList>();

export default function TabsNavigator() {
    return (
        <Tab.Navigator screenOptions={({ route }) => ({
            headerShown: false,
            tabBarStyle: (() => {
                const focusedRouteName = getFocusedRouteNameFromRoute(route);

                if (route.name === "ChatsTab" && focusedRouteName === "ChatRoom") {
                    return { display: "none" };
                }

                return undefined;
            })(),
            tabBarIcon: ({ focused, color, size }) => {
                let iconName: keyof typeof Ionicons.glyphMap = "ellipse-outline";

                if (route.name === "ChatsTab") {
                    iconName = focused ? "chatbubbles" : "chatbubbles-outline";
                } else if (route.name === "CallsTab") {
                    iconName = focused ? "call" : "call-outline";
                } else if (route.name === "ProfileTab") {
                    iconName = focused ? "person" : "person-outline";
                }

                return <Ionicons name={iconName} size={size} color={color} />;
            },
            tabBarActiveTintColor: "tomato",
            tabBarInactiveTintColor: "gray",
        })}>
            <Tab.Screen name="ChatsTab" component={ChatsStack} options={{ title: "Chats" }} />
            <Tab.Screen name="CallsTab" component={CallsStack} options={{ title: "Calls" }} />
            <Tab.Screen name="ProfileTab" component={ProfileStack} options={{ title: "Profile" }} />
        </Tab.Navigator>
    );
}
