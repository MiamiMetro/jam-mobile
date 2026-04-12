import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { authClient } from "../../lib/auth-client";

export default function ProfileSetupScreen() {
  const createProfile = useMutation(api.profiles.createProfile);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmedUsername = username.trim();
    const trimmedDisplayName = displayName.trim();

    if (!trimmedUsername) {
      setError("Username is required.");
      return;
    }

    try {
      setError(null);
      setIsSubmitting(true);
      await createProfile({
        username: trimmedUsername,
        displayName: trimmedDisplayName || trimmedUsername,
      });
    } catch (err) {
      setError(getProfileErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    setError(null);
    await authClient.signOut();
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardView}
      >
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.kicker}>Almost there</Text>
            <Text style={styles.title}>Pick your stage name</Text>
            <Text style={styles.description}>
              This profile is required before you can enter Jam.
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.label}>Username</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isSubmitting}
                maxLength={15}
                onChangeText={(value) => {
                  setUsername(value);
                  setError(null);
                }}
                placeholder="johndoe"
                placeholderTextColor="#6B7280"
                style={styles.input}
                value={username}
              />
              <Text style={styles.hint}>
                3-15 characters. Letters, numbers, and underscores.
              </Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Display name</Text>
              <TextInput
                editable={!isSubmitting}
                maxLength={50}
                onChangeText={(value) => {
                  setDisplayName(value);
                  setError(null);
                }}
                placeholder="John Doe"
                placeholderTextColor="#6B7280"
                style={styles.input}
                value={displayName}
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              disabled={isSubmitting}
              onPress={handleSubmit}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && !isSubmitting ? styles.buttonPressed : null,
                isSubmitting ? styles.buttonDisabled : null,
              ]}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#030712" />
              ) : (
                <Text style={styles.primaryButtonText}>Create profile</Text>
              )}
            </Pressable>

            <Pressable disabled={isSubmitting} onPress={handleSignOut} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Sign out</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function getProfileErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("USERNAME_TAKEN:")) {
    return "Username already taken. Please try a different one.";
  }
  if (message.includes("USERNAME_RESERVED:")) {
    return "This username is reserved. Please choose another one.";
  }
  if (message.includes("USERNAME_TOO_SHORT:")) {
    return "Username is too short.";
  }
  if (message.includes("USERNAME_TOO_LONG:")) {
    return "Username is too long.";
  }
  if (message.includes("USERNAME_INVALID_CHARS:")) {
    return "Username can only use letters, numbers, and underscores.";
  }
  if (message.includes("PROFILE_EXISTS:")) {
    return "Profile already exists. Please sign in again.";
  }

  return message || "Failed to create profile.";
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#030712",
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  header: {
    marginBottom: 28,
  },
  kicker: {
    color: "#22C55E",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 10,
    textTransform: "uppercase",
  },
  title: {
    color: "#F9FAFB",
    fontSize: 30,
    fontWeight: "800",
    marginBottom: 12,
  },
  description: {
    color: "#9CA3AF",
    fontSize: 15,
    lineHeight: 22,
  },
  form: {
    gap: 16,
  },
  field: {
    gap: 8,
  },
  label: {
    color: "#E5E7EB",
    fontSize: 13,
    fontWeight: "700",
  },
  input: {
    backgroundColor: "#111827",
    borderColor: "#1F2937",
    borderRadius: 8,
    borderWidth: 1,
    color: "#F9FAFB",
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  hint: {
    color: "#6B7280",
    fontSize: 12,
    lineHeight: 18,
  },
  error: {
    backgroundColor: "#7F1D1D",
    borderColor: "#991B1B",
    borderRadius: 8,
    borderWidth: 1,
    color: "#FEE2E2",
    padding: 12,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#A7F3D0",
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#030712",
    fontSize: 16,
    fontWeight: "800",
  },
  secondaryButton: {
    alignItems: "center",
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: "#9CA3AF",
    fontSize: 14,
    fontWeight: "700",
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
});
