import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import RootNavigator from "./src/navigation/RootNavigator";

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!);

const App = () => {
  return (
    <ConvexProvider client={convex}>
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </ConvexProvider>
  );
};

export default App;
