import React, { useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useMutation } from "convex/react";
import AudioPostPlayer from "@/components/posts/AudioPostPlayer";
import type { PostFeedItem } from "@/types";
import { useMyProfile } from "@/hooks/useMyProfile";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type Props = {
  post: PostFeedItem;
};

export default function PostItem({ post }: Props) {
  const navigation = useNavigation<any>();
  const removePost = useMutation(api.posts.remove);
  const { profile } = useMyProfile();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const authorName = post.author?.username ?? "unknown";
  const isOwnPost = profile?.id === post.author_id;
  const fallbackLetters = useMemo(
    () => authorName.slice(0, 2).toUpperCase(),
    [authorName]
  );
  const createdAt = useMemo(() => formatRelativeTime(post.created_at), [post.created_at]);

  if (post.deleted_at) {
    return null;
  }

  const handleDelete = async () => {
    if (!isOwnPost || isDeleting) return;

    try {
      setIsDeleting(true);
      await removePost({ postId: post.id as Id<"posts"> });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Pressable style={({ pressed }) => [styles.container, pressed ? styles.pressed : null]}>
      <View style={styles.avatar}>
        {post.author?.avatar_url && !avatarFailed ? (
          <Image
            onError={() => setAvatarFailed(true)}
            source={{ uri: post.author.avatar_url }}
            style={styles.avatarImage}
          />
        ) : (
          <Text style={styles.avatarFallback}>{fallbackLetters}</Text>
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.metaRow}>
          <Text style={styles.author}>{authorName}</Text>
          {isOwnPost ? (
            <Pressable disabled={isDeleting} onPress={handleDelete} style={styles.deleteButton}>
              <Ionicons color={isDeleting ? "#4B5565" : "#8F98A8"} name="trash-outline" size={14} />
            </Pressable>
          ) : null}
          {post.community_handle ? (
            <View style={styles.communityBadge}>
              <Text style={styles.communityText}>#{post.community_handle}</Text>
            </View>
          ) : null}
          <Text style={styles.timestamp}>- {createdAt}</Text>
        </View>

        {post.text ? <Text style={styles.content}>{post.text}</Text> : null}

        {post.audio_url ? (
          <AudioPostPlayer
            audioUrl={post.audio_url}
            duration={post.audio_duration}
            style={styles.audioPlayer}
            title={post.audio_title}
          />
        ) : null}

        <View style={styles.actionsRow}>
          <Text style={styles.actionText}>Heart {post.likes_count}</Text>
          <Pressable
            onPress={() => navigation.navigate("PostDetail", { postId: post.id })}
            style={styles.commentAction}
          >
            <Ionicons color="#8F98A8" name="chatbubble-outline" size={14} />
            <Text style={styles.actionText}>Comments {post.comments_count}</Text>
          </Pressable>
          <Text style={styles.actionText}>Share</Text>
        </View>
      </View>
    </Pressable>
  );
}

function formatRelativeTime(value: string) {
  const createdAt = new Date(value).getTime();
  if (Number.isNaN(createdAt)) return "";

  const diffSeconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
  if (diffSeconds < 60) return "now";

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;

  return new Date(value).toLocaleDateString();
}

const styles = StyleSheet.create({
  container: {
    borderBottomColor: "rgba(255,255,255,0.08)",
    borderBottomWidth: 1,
    borderLeftColor: "transparent",
    borderLeftWidth: 2,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  pressed: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderLeftColor: "rgba(216,166,74,0.45)",
  },
  avatar: {
    alignItems: "center",
    backgroundColor: "#303644",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    overflow: "hidden",
    width: 44,
  },
  avatarImage: {
    height: 44,
    width: 44,
  },
  avatarFallback: {
    color: "#AEB6C4",
    fontSize: 13,
    fontWeight: "800",
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  metaRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 8,
  },
  author: {
    color: "#EEF0F5",
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "800",
  },
  deleteButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 28,
    justifyContent: "center",
    marginLeft: "auto",
    width: 28,
  },
  communityBadge: {
    backgroundColor: "rgba(216,166,74,0.12)",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  communityText: {
    color: "#D8A64A",
    fontSize: 11,
    fontWeight: "800",
  },
  timestamp: {
    color: "#8F98A8",
    fontSize: 12,
    fontWeight: "600",
  },
  content: {
    color: "#EEF0F5",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },
  audioPlayer: {
    marginBottom: 12,
  },
  actionsRow: {
    borderTopColor: "rgba(255,255,255,0.06)",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 20,
    paddingTop: 11,
  },
  actionText: {
    color: "#8F98A8",
    fontSize: 13,
    fontWeight: "700",
  },
  commentAction: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
  },
});
