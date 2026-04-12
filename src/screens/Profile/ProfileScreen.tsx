import React from "react";
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from "react-native";
import ProfileHeader from "@/components/profile/ProfileHeader";
import PostList from "@/components/posts/PostList";
import { useMyProfile } from "@/hooks/useMyProfile";
import { useProfilePosts } from "@/hooks/useProfilePosts";
import { authClient } from "@/lib/auth-client";

const ProfileScreen = () => {
  const { profile, isLoading: isProfileLoading } = useMyProfile();
  const { posts, isLoading, isLoadingMore, canLoadMore, loadMore } = useProfilePosts(
    profile?.username
  );

  if (isProfileLoading) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator color="#F9FAFB" />
        <Text style={styles.stateText}>Profile is loading...</Text>
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.stateText}>No profile found.</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ProfileHeader profile={profile} onSignOut={() => authClient.signOut()} />
      <PostList
        posts={posts}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        onEndReached={() => {
          if (canLoadMore && !isLoadingMore) {
            loadMore(10);
          }
        }}
      />
    </SafeAreaView>
  );
};

export default ProfileScreen;

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#030712",
    flex: 1,
  },
  centerState: {
    alignItems: "center",
    backgroundColor: "#030712",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  stateText: {
    color: "#9CA3AF",
    marginTop: 12,
    textAlign: "center",
  },
});
