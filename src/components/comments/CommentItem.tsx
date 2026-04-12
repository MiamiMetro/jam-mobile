import { Ionicons } from "@expo/vector-icons";
import { useMutation, usePaginatedQuery } from "convex/react";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import type { Comment, User } from "@/types";
import CommentComposer from "./CommentComposer";

type Props = {
  comment: Comment;
  currentProfile: User | null | undefined;
  depth?: number;
};

const INDENT_WIDTH = 16;
const MAX_VISIBLE_DEPTH = 4;

export default function CommentItem({ comment, currentProfile, depth = 0 }: Props) {
  const toggleLike = useMutation(api.comments.toggleLike);
  const deleteComment = useMutation(api.comments.remove);
  const createReply = useMutation(api.comments.reply);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [repliesExpanded, setRepliesExpanded] = useState(false);
  const [replying, setReplying] = useState(false);
  const [isReplySubmitting, setIsReplySubmitting] = useState(false);
  const [isMutating, setIsMutating] = useState(false);

  const repliesQuery = usePaginatedQuery(
    api.comments.getRepliesPaginated,
    repliesExpanded ? { parentId: comment.id as Id<"comments"> } : "skip",
    { initialNumItems: 10 }
  );

  const authorName = comment.author?.username ?? "unknown";
  const isOwn = currentProfile?.username === authorName;
  const isDeleted = Boolean(comment.deleted_at);
  const visibleReplies = useMemo(
    () => repliesQuery.results.filter((reply) => !reply.deleted_at || reply.replies_count > 0),
    [repliesQuery.results]
  );
  const fallbackLetters = useMemo(
    () => authorName.slice(0, 2).toUpperCase(),
    [authorName]
  );
  const createdAt = useMemo(() => formatRelativeTime(comment.created_at), [comment.created_at]);

  const handleToggleLike = async () => {
    if (isDeleted || isMutating) return;
    try {
      setIsMutating(true);
      await toggleLike({ commentId: comment.id as Id<"comments"> });
    } finally {
      setIsMutating(false);
    }
  };

  const handleDelete = async () => {
    if (!isOwn || isMutating) return;
    try {
      setIsMutating(true);
      await deleteComment({ commentId: comment.id as Id<"comments"> });
    } finally {
      setIsMutating(false);
    }
  };

  const handleReply = async (text: string) => {
    try {
      setIsReplySubmitting(true);
      await createReply({
        parentId: comment.id as Id<"comments">,
        text,
      });
      setReplying(false);
      setRepliesExpanded(true);
    } finally {
      setIsReplySubmitting(false);
    }
  };

  const leftOffset = Math.min(depth, MAX_VISIBLE_DEPTH) * INDENT_WIDTH;

  return (
    <View style={[styles.wrapper, { marginLeft: leftOffset }]}>
      <View style={[styles.row, depth > 0 ? styles.replyRow : null]}>
        {depth > 0 ? <View style={styles.threadLine} /> : null}

        <View style={styles.avatar}>
          {comment.author?.avatar_url && !avatarFailed && !isDeleted ? (
            <Image
              onError={() => setAvatarFailed(true)}
              source={{ uri: comment.author.avatar_url }}
              style={styles.avatarImage}
            />
          ) : (
            <Text style={styles.avatarFallback}>{isDeleted ? "--" : fallbackLetters}</Text>
          )}
        </View>

        <View style={styles.body}>
          <View style={styles.metaRow}>
            <Text style={styles.author}>{isDeleted ? "deleted" : authorName}</Text>
            <Text style={styles.timestamp}>- {createdAt}</Text>
          </View>

          {isDeleted ? (
            <Text style={styles.deletedText}>Comment removed</Text>
          ) : (
            <Text style={styles.content}>{comment.text}</Text>
          )}

          <View style={styles.actionsRow}>
            <Pressable
              disabled={isDeleted || isMutating}
              onPress={handleToggleLike}
              style={styles.action}
            >
              <Ionicons
                color={comment.is_liked ? "#EF4444" : "#8F98A8"}
                name={comment.is_liked ? "heart" : "heart-outline"}
                size={15}
              />
              <Text style={[styles.actionText, comment.is_liked ? styles.likedText : null]}>
                {comment.likes_count}
              </Text>
            </Pressable>

            {!isDeleted ? (
              <Pressable onPress={() => setReplying((value) => !value)} style={styles.action}>
                <Ionicons color="#8F98A8" name="chatbubble-outline" size={14} />
                <Text style={styles.actionText}>Reply</Text>
              </Pressable>
            ) : null}

            {comment.replies_count > 0 ? (
              <Pressable
                onPress={() => setRepliesExpanded((value) => !value)}
                style={styles.action}
              >
                <Text style={styles.primaryActionText}>
                  {repliesExpanded ? "Hide" : `View ${comment.replies_count}`}
                </Text>
              </Pressable>
            ) : null}

            {isOwn && !isDeleted ? (
              <Pressable disabled={isMutating} onPress={handleDelete} style={styles.action}>
                <Ionicons color="#8F98A8" name="trash-outline" size={14} />
              </Pressable>
            ) : null}
          </View>

          {replying ? (
            <View style={styles.replyComposer}>
              <View style={styles.replyHeader}>
                <Text style={styles.replyingText}>Replying to @{authorName}</Text>
                <Pressable onPress={() => setReplying(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              </View>
              <CommentComposer
                buttonLabel="Reply"
                initialValue={`@${authorName} `}
                isSubmitting={isReplySubmitting}
                onSubmit={handleReply}
                placeholder={`Reply to @${authorName}...`}
              />
            </View>
          ) : null}

          {repliesExpanded ? (
            <View style={styles.replies}>
              {repliesQuery.status === "LoadingFirstPage" ? (
                <View style={styles.loadingReplies}>
                  <ActivityIndicator color="#D8A64A" />
                  <Text style={styles.loadingText}>Loading replies...</Text>
                </View>
              ) : (
                visibleReplies.map((reply) => (
                  <CommentItem
                    key={reply.id}
                    comment={reply}
                    currentProfile={currentProfile}
                    depth={depth + 1}
                  />
                ))
              )}

              {repliesQuery.status === "CanLoadMore" ? (
                <Pressable
                  onPress={() => repliesQuery.loadMore(10)}
                  style={styles.loadMoreReplies}
                >
                  <Text style={styles.primaryActionText}>Load more replies</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </View>
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
  wrapper: {
    borderBottomColor: "rgba(255,255,255,0.06)",
    borderBottomWidth: 1,
  },
  row: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  replyRow: {
    paddingLeft: 0,
  },
  threadLine: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 1,
    width: 2,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: "#303644",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 17,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    overflow: "hidden",
    width: 34,
  },
  avatarImage: {
    height: 34,
    width: 34,
  },
  avatarFallback: {
    color: "#AEB6C4",
    fontSize: 11,
    fontWeight: "800",
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  metaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    marginBottom: 5,
  },
  author: {
    color: "#EEF0F5",
    fontSize: 13,
    fontWeight: "800",
  },
  timestamp: {
    color: "#8F98A8",
    fontSize: 11,
    fontWeight: "600",
  },
  content: {
    color: "#EEF0F5",
    fontSize: 14,
    lineHeight: 21,
  },
  deletedText: {
    color: "#8F98A8",
    fontSize: 13,
    fontStyle: "italic",
    lineHeight: 20,
  },
  actionsRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    marginTop: 9,
  },
  action: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  actionText: {
    color: "#8F98A8",
    fontSize: 12,
    fontWeight: "700",
  },
  likedText: {
    color: "#EF4444",
  },
  primaryActionText: {
    color: "#D8A64A",
    fontSize: 12,
    fontWeight: "800",
  },
  replyComposer: {
    marginTop: 12,
  },
  replyHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  replyingText: {
    color: "#8F98A8",
    fontSize: 12,
    fontWeight: "700",
  },
  cancelText: {
    color: "#D8A64A",
    fontSize: 12,
    fontWeight: "800",
  },
  replies: {
    marginTop: 8,
  },
  loadingReplies: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingVertical: 10,
  },
  loadingText: {
    color: "#8F98A8",
    fontSize: 12,
    fontWeight: "700",
  },
  loadMoreReplies: {
    paddingVertical: 10,
  },
});

