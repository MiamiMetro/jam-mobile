import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useConvexAuth, useQuery } from "convex/react";

import AuthStack from "./AuthStack";
import MainTabs from "./MainTabs";
import ProfileSetupScreen from "../screens/Auth/ProfileSetupScreen";
import PostDetailScreen from "../screens/Posts/PostDetailScreen";
import { authClient } from "../lib/auth-client";
import { api } from "../../convex/_generated/api";

export type RootStackParamList = {
  Auth: undefined;
  ProfileSetup: undefined;
  Main: undefined;
  PostDetail: { postId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const { isLoading: isConvexAuthLoading, isAuthenticated } = useConvexAuth();
  const hasSession = Boolean(session?.session);
  const canLoadProfile = hasSession && !isConvexAuthLoading && isAuthenticated;
  const profile = useQuery(api.profiles.getMe, canLoadProfile ? {} : "skip");

  if (
    isSessionPending ||
    (hasSession && (isConvexAuthLoading || !isAuthenticated)) ||
    (canLoadProfile && profile === undefined)
  ) {
    return <AuthLoadingScreen />;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!hasSession ? (
        <Stack.Screen name="Auth" component={AuthStack} />
      ) : profile ? (
        <>
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="PostDetail" component={PostDetailScreen} />
        </>
      ) : (
        <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
      )}
    </Stack.Navigator>
  );
}

function AuthLoadingScreen() {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator color="#F9FAFB" />
      <Text style={styles.loadingText}>Session is loading...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    alignItems: "center",
    backgroundColor: "#030712",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  loadingText: {
    color: "#9CA3AF",
    marginTop: 12,
    textAlign: "center",
  },
});
