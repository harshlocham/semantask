import "react-native-gesture-handler";
import { registerRootComponent } from "expo";

import App from "./App";

// registerRootComponent calls AppRegistry.registerComponent("main", () => App)
// and ensures the app is set up correctly in Expo Go and native builds.
registerRootComponent(App);
