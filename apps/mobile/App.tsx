import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "./global.css";

import { AppQueryProvider } from "./src/app/providers/query-provider";
import { SocketProvider } from "./src/providers/socket-provider";
import AppNavigator from "./src/app/navigation/AppNavigator";

export default function App() {
  return (
    <SafeAreaProvider>
      <AppQueryProvider>
        <SocketProvider>
          <StatusBar style="auto" />
          <AppNavigator />
        </SocketProvider>
      </AppQueryProvider>
    </SafeAreaProvider>
  );
}