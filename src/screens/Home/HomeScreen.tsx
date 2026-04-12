import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import React from "react";
import PostList from "@/components/posts/PostList";
import ComposePost from "@/components/posts/ComposePost";
import { usePosts } from "@/hooks/usePosts";
import { useMyProfile } from "@/hooks/useMyProfile";

const HomeScreen = () => {
  const { posts, isLoading, isLoadingMore, canLoadMore, loadMore } = usePosts();
  const { profile } = useMyProfile();

  return (
    <SafeAreaView style={styles.container}>
      <PostList
        posts={posts}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              <Text style={styles.headerIcon}>RSS</Text>
              <Text style={styles.headerTitle}>Feed</Text>
            </View>
            <ComposePost profile={profile} />
          </>
        }
        onEndReached={() => {
          if (canLoadMore && !isLoadingMore) {
            loadMore(10);
          }
        }}
      />
    </SafeAreaView>
  );
};

export default HomeScreen;

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#1A1E29",
    flex: 1,
  },
  header: {
    alignItems: "center",
    borderBottomColor: "rgba(255,255,255,0.08)",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  headerIcon: {
    color: "#8F98A8",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0,
  },
  headerTitle: {
    color: "#B0B7C4",
    fontSize: 14,
    fontWeight: "800",
  },
});
