import { query, mutation } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id, Doc } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import {
  extractManagedMediaObjectKeyFromUrl,
  resolvePublicMediaUrl,
} from "./mediaService";
import { consumeReadyUploadSessionByPublicUrl } from "./uploadSessions";
import {
  formatPublicProfileIdentity,
  getCurrentProfile,
  requireAuth,
  getUniqueLock,
  acquireUniqueLock,
  releaseUniqueLock,
  validateTextLength,
  validateUrl,
  sanitizeText,
  MAX_LENGTHS,
} from "./helpers";
import { checkRateLimit } from "./rateLimiter";

/**
 * Generate the next path segment for a comment.
 * Paths are 4-digit zero-padded numbers (0001, 0002, etc.)
 */
function generateNextSegment(existingCount: number): string {
  return String(existingCount + 1).padStart(4, "0");
}

/**
 * Format a comment for API response
 */
async function formatComment(
  ctx: QueryCtx | MutationCtx,
  comment: Doc<"comments">,
  currentUserId?: Id<"profiles">,
  options?: { author?: Doc<"profiles"> | null }
) {
  const author =
    options?.author !== undefined
      ? options.author
      : await ctx.db.get(comment.authorId);

  // Use denormalized counts for O(1) performance
  const likesCount = comment.likesCount ?? 0;
  const repliesCount = comment.repliesCount ?? 0;

  // Check if current user liked this comment
  let isLiked = false;
  if (currentUserId) {
    const likeLock = await getUniqueLock(
      ctx,
      "comment_like",
      `${comment._id}:${currentUserId}`
    );
    isLiked = !!likeLock;
  }

  const isDeleted = comment.deletedAt != null;

  return {
    id: comment._id,
    post_id: comment.postId,
    author_id: comment.authorId,
    parent_id: comment.parentId ?? null,
    path: comment.path,
    depth: comment.depth,
    text: isDeleted ? "" : (comment.text ?? ""),
    audio_url: isDeleted ? null : resolvePublicMediaUrl({
      url: comment.audioUrl,
      objectKey: comment.audioObjectKey,
    }),
    audio_title: isDeleted ? null : (comment.audioTitle ?? null),
    audio_duration: isDeleted ? null : (comment.audioDuration ?? null),
    created_at: new Date(comment._creationTime).toISOString(),
    author: author
      ? formatPublicProfileIdentity(author)
      : null,
    likes_count: likesCount,
    replies_count: repliesCount,
    is_liked: isLiked,
    deleted_at: comment.deletedAt ?? null,
  };
}



/**
 * Create a top-level comment on a post
 */
export const create = mutation({
  args: {
    postId: v.id("posts"),
    text: v.optional(v.string()),
    audioUrl: v.optional(v.string()),
    audioTitle: v.optional(v.string()),
    audioDuration: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);

    // Rate limit: 10 comments per minute
    await checkRateLimit(ctx, "createComment", profile._id);

    // Verify post exists
    const post = await ctx.db.get(args.postId);
    if (!post) {
      throw new Error("Post not found");
    }

    // Sanitize and validate inputs
    const text = sanitizeText(args.text);
    const audioUrl = args.audioUrl;
    const audioObjectKey = extractManagedMediaObjectKeyFromUrl(audioUrl);

    validateTextLength(text, MAX_LENGTHS.COMMENT_TEXT, "Comment text");
    validateUrl(audioUrl);

    if (!text && !audioUrl) {
      throw new Error("Comment must have either text or audio");
    }

    let nextAudioUrl = audioUrl;
    let nextAudioObjectKey = audioObjectKey;
    if (audioUrl && audioObjectKey) {
      const audioSession = await consumeReadyUploadSessionByPublicUrl(ctx, {
        ownerProfileId: profile._id,
        publicUrl: audioUrl,
        kind: "audio",
      });
      nextAudioObjectKey = audioSession.objectKey;
      nextAudioUrl = undefined;
    }
    if (audioUrl && !audioObjectKey) {
      nextAudioObjectKey = undefined;
    }

    // Get parent post for atomic sequence counter
    const parentPost = await ctx.db.get(args.postId);
    if (!parentPost) {
      throw new Error("Post not found");
    }

    // Atomically increment sequence counter to generate unique path
    // This guarantees no duplicate paths even under concurrent comment creation
    const nextSeq = (parentPost.nextCommentSequence ?? 0) + 1;
    await ctx.db.patch(args.postId, {
      nextCommentSequence: nextSeq,
      commentsCount: (parentPost.commentsCount ?? 0) + 1,
    });

    // Generate path using the atomic sequence
    const path = generateNextSegment(nextSeq);

    const commentId = await ctx.db.insert("comments", {
      postId: args.postId,
      authorId: profile._id,
      parentId: undefined,
      path,
      depth: 0,
      text,
      audioUrl: nextAudioUrl,
      audioObjectKey: nextAudioObjectKey,
      audioTitle: args.audioTitle,
      audioDuration: args.audioDuration,
      likesCount: 0,
      repliesCount: 0,
      nextReplySequence: 0, // Initialize counter for this comment's replies
    });

    const comment = await ctx.db.get(commentId);
    if (!comment) {
      throw new Error("Failed to create comment");
    }

    return await formatComment(ctx, comment, profile._id);
  },
});

/**
 * Reply to an existing comment (threaded)
 */
export const reply = mutation({
  args: {
    parentId: v.id("comments"),
    text: v.optional(v.string()),
    audioUrl: v.optional(v.string()),
    audioTitle: v.optional(v.string()),
    audioDuration: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    
    // Rate limit: 10 replies per minute
    await checkRateLimit(ctx, "replyToComment", profile._id);

    // Verify parent comment exists
    const parent = await ctx.db.get(args.parentId);
    if (!parent) {
      throw new Error("Parent comment not found");
    }

    // Sanitize and validate inputs
    const text = sanitizeText(args.text);
    const audioUrl = args.audioUrl;
    const audioObjectKey = extractManagedMediaObjectKeyFromUrl(audioUrl);

    validateTextLength(text, MAX_LENGTHS.COMMENT_TEXT, "Comment text");
    validateUrl(audioUrl);

    if (!text && !audioUrl) {
      throw new Error("Reply must have either text or audio");
    }

    let nextAudioUrl = audioUrl;
    let nextAudioObjectKey = audioObjectKey;
    if (audioUrl && audioObjectKey) {
      const audioSession = await consumeReadyUploadSessionByPublicUrl(ctx, {
        ownerProfileId: profile._id,
        publicUrl: audioUrl,
        kind: "audio",
      });
      nextAudioObjectKey = audioSession.objectKey;
      nextAudioUrl = undefined;
    }
    if (audioUrl && !audioObjectKey) {
      nextAudioObjectKey = undefined;
    }

    // Atomically increment sequence counter to generate unique path
    // This guarantees no duplicate paths even under concurrent reply creation
    const nextSeq = (parent.nextReplySequence ?? 0) + 1;
    await ctx.db.patch(args.parentId, {
      nextReplySequence: nextSeq,
      repliesCount: (parent.repliesCount ?? 0) + 1,
    });

    // Generate path using the atomic sequence
    const newSegment = generateNextSegment(nextSeq);
    const path = `${parent.path}.${newSegment}`;

    const commentId = await ctx.db.insert("comments", {
      postId: parent.postId,
      authorId: profile._id,
      parentId: args.parentId,
      path,
      depth: parent.depth + 1,
      text,
      audioUrl: nextAudioUrl,
      audioObjectKey: nextAudioObjectKey,
      audioTitle: args.audioTitle,
      audioDuration: args.audioDuration,
      likesCount: 0,
      repliesCount: 0,
      nextReplySequence: 0, // Initialize counter for this comment's replies
    });

    const comment = await ctx.db.get(commentId);
    if (!comment) {
      throw new Error("Failed to create reply");
    }

    return await formatComment(ctx, comment, profile._id);
  },
});

/**
 * Get post comments ordered by path using native Convex pagination.
 * This is the preferred endpoint for Convex-first frontend pagination.
 * Note: `maxDepth` filtering is intentionally not supported in this endpoint.
 */
export const getByPostPaginated = query({
  args: {
    postId: v.id("posts"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const currentProfile = await getCurrentProfile(ctx);
    const post = await ctx.db.get(args.postId);
    if (!post) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const result = await ctx.db
      .query("comments")
      .withIndex("by_post_and_path", (q) => q.eq("postId", args.postId))
      .paginate(args.paginationOpts);

    const uniqueAuthorIds = [...new Set(result.page.map((comment) => comment.authorId))];
    const authorEntries = await Promise.all(
      uniqueAuthorIds.map(async (authorId) => [authorId, await ctx.db.get(authorId)] as const)
    );
    const authorMap = new Map(authorEntries);

    const formatted = await Promise.all(
      result.page.map((comment) =>
        formatComment(ctx, comment, currentProfile?._id, {
          author: authorMap.get(comment.authorId) ?? null,
        })
      )
    );

    return {
      ...result,
      page: formatted,
    };
  },
});

/**
 * Get replies to a specific comment using native Convex pagination.
 * This is the preferred endpoint for Convex-first frontend pagination.
 */
export const getRepliesPaginated = query({
  args: {
    parentId: v.id("comments"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const currentProfile = await getCurrentProfile(ctx);
    const parent = await ctx.db.get(args.parentId);
    if (!parent) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const result = await ctx.db
      .query("comments")
      .withIndex("by_parent", (q) => q.eq("parentId", args.parentId))
      .paginate(args.paginationOpts);

    const uniqueAuthorIds = [...new Set(result.page.map((comment) => comment.authorId))];
    const authorEntries = await Promise.all(
      uniqueAuthorIds.map(async (authorId) => [authorId, await ctx.db.get(authorId)] as const)
    );
    const authorMap = new Map(authorEntries);

    const page = await Promise.all(
      result.page.map((comment) =>
        formatComment(ctx, comment, currentProfile?._id, {
          author: authorMap.get(comment.authorId) ?? null,
        })
      )
    );

    return {
      ...result,
      page,
    };
  },
});

/**
 * Get a single comment by ID
 */
export const getById = query({
  args: {
    commentId: v.id("comments"),
  },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (!comment) {
      return null;
    }

    const currentProfile = await getCurrentProfile(ctx);
    return await formatComment(ctx, comment, currentProfile?._id);
  },
});

/**
 * Toggle like on a comment
 */
export const toggleLike = mutation({
  args: {
    commentId: v.id("comments"),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    
    // Rate limit: 30 likes per minute
    await checkRateLimit(ctx, "toggleLike", profile._id);

    const comment = await ctx.db.get(args.commentId);
    if (!comment) {
      throw new Error("Comment not found");
    }

    const lockValue = `${args.commentId}:${profile._id}`;
    const existingLock = await getUniqueLock(ctx, "comment_like", lockValue);

    if (existingLock) {
      // Unlike
      const existingLike = await ctx.db
        .query("comment_likes")
        .withIndex("by_comment_and_user", (q) =>
          q.eq("commentId", args.commentId).eq("userId", profile._id)
        )
        .first();
      if (existingLike) {
        await ctx.db.delete(existingLike._id);
      }
      await releaseUniqueLock(ctx, "comment_like", lockValue);

      await ctx.db.patch(args.commentId, {
        likesCount: Math.max(0, (comment.likesCount ?? 0) - 1),
      });
    } else {
      const lockResult = await acquireUniqueLock(
        ctx,
        "comment_like",
        lockValue,
        profile._id
      );

      // A racing like already acquired the lock; return current state.
      if (!lockResult.acquired) {
        const latest = await ctx.db.get(args.commentId);
        if (!latest) {
          throw new Error("Comment not found");
        }
        return await formatComment(ctx, latest, profile._id);
      }

      const existingLike = await ctx.db
        .query("comment_likes")
        .withIndex("by_comment_and_user", (q) =>
          q.eq("commentId", args.commentId).eq("userId", profile._id)
        )
        .first();
      if (!existingLike) {
        await ctx.db.insert("comment_likes", {
          commentId: args.commentId,
          userId: profile._id,
        });
      }

      await ctx.db.patch(args.commentId, {
        likesCount: (comment.likesCount ?? 0) + 1,
      });
    }

    // Refetch comment to get updated count
    const updatedComment = await ctx.db.get(args.commentId);
    return await formatComment(ctx, updatedComment!, profile._id);
  },
});

/**
 * Delete a comment (only owner can delete)
 * Optionally deletes all replies (cascade)
 */
export const remove = mutation({
  args: {
    commentId: v.id("comments"),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);

    // Rate limit: 10 deletes per minute
    await checkRateLimit(ctx, "deleteAction", profile._id);

    const comment = await ctx.db.get(args.commentId);
    if (!comment) {
      throw new Error("Comment not found");
    }

    if (comment.authorId !== profile._id) {
      throw new Error("You can only delete your own comments");
    }

    // Soft delete: mark deleted and clear content. The document is kept so
    // threaded replies still have a parent. The query layer will render a
    // placeholder for deleted-but-replied-to comments, and will exclude
    // deleted leaf comments from results entirely.
    await ctx.db.patch(args.commentId, {
      deletedAt: Date.now(),
      text: undefined,
      audioUrl: undefined,
      audioObjectKey: undefined,
    });

    // Only decrement counts when the comment is a leaf (will be excluded from results)
    const hasReplies = (comment.repliesCount ?? 0) > 0;
    if (!hasReplies) {
      if (comment.parentId) {
        const parentComment = await ctx.db.get(comment.parentId);
        if (parentComment) {
          await ctx.db.patch(comment.parentId, {
            repliesCount: Math.max(0, (parentComment.repliesCount ?? 0) - 1),
          });
        }
      } else {
        const postDoc = await ctx.db.get(comment.postId);
        if (postDoc) {
          await ctx.db.patch(comment.postId, {
            commentsCount: Math.max(0, (postDoc.commentsCount ?? 0) - 1),
          });
        }
      }
    }

    return { message: "Comment deleted successfully" };
  },
});

/**
 * Get comment count for a post (for display in post cards)
 */
export const getCountByPost = query({
  args: {
    postId: v.id("posts"),
  },
  handler: async (ctx, args) => {
    // Use denormalized counter for O(1) performance instead of .collect()
    // This prevents OOM issues on posts with many comments
    const post = await ctx.db.get(args.postId);
    if (!post) return 0;
    return post.commentsCount ?? 0;
  },
});

