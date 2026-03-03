import { FlatList, View } from "react-native";
import type { Post } from "@/types";
import PostItem from "./PostItem";

type Props = {
  posts: Post[];
};

export default function PostList({ posts }: Props) {
    return (
        <FlatList
            data={posts}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <PostItem post={item} />}
        />
    );
}