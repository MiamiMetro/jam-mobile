import { StyleSheet, Text, View, ActivityIndicator, SafeAreaView } from 'react-native'
import React from 'react'
import PostList from '@/components/posts/PostList';
import { usePosts } from "@/hooks/usePosts";


const HomeScreen = () => {
  const { posts, isLoading, isLoadingMore, loadMore } = usePosts();

   if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  
   return (
    <SafeAreaView style={styles.container}>
      <PostList
        posts={posts}
        onEndReached={() => {
          if (!isLoadingMore) {
            loadMore(10);
          }
        }}
      />
    </SafeAreaView>
  );
};

export default HomeScreen

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});