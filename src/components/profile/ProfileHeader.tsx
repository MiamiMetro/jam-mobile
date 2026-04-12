import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { User } from "@/types";

type Props = {
  profile: User;
  onSignOut?: () => void;
};

export default function ProfileHeader({ profile, onSignOut }: Props) {
  const hasAvatar = Boolean(profile.avatar_url);
  const fallbackLetter = (profile.display_name || profile.username || "?")
    .slice(0, 1)
    .toUpperCase();

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Profile</Text>
        {onSignOut ? (
          <Pressable onPress={onSignOut} style={styles.signOutButton}>
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.avatarWrapper}>
        {hasAvatar ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarFallbackText}>{fallbackLetter}</Text>
          </View>
        )}
      </View>

      <Text style={styles.displayName}>{profile.display_name || "No display name"}</Text>
      <Text style={styles.username}>@{profile.username}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#030712",
    borderBottomColor: "#171E2A",
    borderBottomWidth: 1,
    paddingBottom: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  headerTitle: {
    color: "#F9FAFB",
    fontSize: 22,
    fontWeight: "700",
  },
  signOutButton: {
    borderColor: "#1F2937",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  signOutText: {
    color: "#D1D5DB",
    fontSize: 13,
    fontWeight: "700",
  },
  avatarWrapper: {
    marginBottom: 16,
  },
  avatar: {
    borderRadius: 44,
    height: 88,
    width: 88,
  },
  avatarFallback: {
    alignItems: "center",
    backgroundColor: "#111827",
    borderColor: "#1F2937",
    borderRadius: 44,
    borderWidth: 1,
    height: 88,
    justifyContent: "center",
    width: 88,
  },
  avatarFallbackText: {
    color: "#F9FAFB",
    fontSize: 30,
    fontWeight: "700",
  },
  displayName: {
    color: "#F9FAFB",
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 6,
  },
  username: {
    color: "#9CA3AF",
    fontSize: 15,
    fontWeight: "500",
  },
});
