import React, { useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import { setAudioModeAsync } from "expo-audio";
import RootNavigator from "./src/navigation/RootNavigator";
import { authClient } from "./src/lib/auth-client";

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
  expectAuth: true,
  unsavedChangesWarning: false,
});

const App = () => {
  useEffect(() => {
    setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: "mixWithOthers",
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    }).catch((error) => {
      console.warn("Failed to configure audio mode", error);
    });
  }, []);

  return (
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </ConvexBetterAuthProvider>
  );
};

export default App;
