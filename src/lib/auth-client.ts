import { expoClient } from "@better-auth/expo/client";
import {
  convexClient,
  crossDomainClient,
} from "@convex-dev/better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const CONVEX_SITE_URL = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
const APP_SCHEME = "jam";

if (!CONVEX_SITE_URL) {
  throw new Error("Missing EXPO_PUBLIC_CONVEX_SITE_URL environment variable");
}

export const authClient = createAuthClient({
  baseURL: CONVEX_SITE_URL,
  plugins: [
    convexClient(),
    ...(Platform.OS === "web"
      ? [crossDomainClient()]
      : [
          expoClient({
            scheme: APP_SCHEME,
            storagePrefix: APP_SCHEME,
            storage: SecureStore,
          }),
        ]),
  ],
});

