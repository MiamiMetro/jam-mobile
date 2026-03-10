import { View, Text } from "react-native";
import type { PostFeedItem } from "@/types";

type Props = {
  post: PostFeedItem;
};

export default function PostItem({ post }: Props) {
  return (
    <View>
      <Text>{post.author?.username}</Text>
      <Text>{post.text}</Text>
    </View>
  );
}
