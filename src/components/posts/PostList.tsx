import { FlatList, View } from "react-native";
import type { PostFeedItem } from "@/types";
import PostItem from "./PostItem";

type Props = {
  posts: PostFeedItem[];
  onEndReached?: () => void;
};

export default function PostList({ posts, onEndReached }: Props) {
    return (
        <FlatList
            data = {posts}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <PostItem post={item} />}
            onEndReached = {onEndReached}
            onEndReachedThreshold={0.5}           
        />
    );
}
