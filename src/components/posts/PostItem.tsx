import { View, Text } from "react-native";
import type { Post } from "../../types";

type Props = {
  post: Post;
};

export default function PostItem({ post }: Props) {
  return (
    <View>
        <Text>{post.author?.username}</Text>
        <Text>{post.text}</Text>
    </View>
  );
}