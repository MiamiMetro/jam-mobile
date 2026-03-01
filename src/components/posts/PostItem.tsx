import { View, Text } from "react-native";
import type { Post } from "../../types/post";

type Props = {
  post: Post;
};

export default function PostItem({ post }: Props) {
  return (
    <View>
        <Text>{post.author.username}</Text>
        <Text>{post.content}</Text>
    </View>
  );
}