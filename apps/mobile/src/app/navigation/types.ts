import type { NavigatorScreenParams } from "@react-navigation/native";

export type AuthStackParamList = {
    Login: undefined;
    Register: undefined;
};

export type ChatsStackParamList = {
    ChatsList: undefined;
    ChatRoom: { conversationId: string };
};

export type CallsStackParamList = {
    CallsList: undefined;
    CallHistoryDetail: { callId: string };
};

export type ProfileStackParamList = {
    Profile: undefined;
    Settings: undefined;
};

export type TabsParamList = {
    ChatsTab: NavigatorScreenParams<ChatsStackParamList>;
    CallsTab: NavigatorScreenParams<CallsStackParamList>;
    ProfileTab: NavigatorScreenParams<ProfileStackParamList>;
};

export type AppStackParamList = {
    TabsNavigator: NavigatorScreenParams<TabsParamList>;
};

export type RootStackParamList = {
    AuthStack: NavigatorScreenParams<AuthStackParamList>;
    AppStack: NavigatorScreenParams<AppStackParamList>;
    CallScreen: { callId?: string; roomId?: string } | undefined;
    IncomingCall: { callId: string; fromUserId?: string };
    MediaViewer: { uri: string; type?: "image" | "video" };
};
