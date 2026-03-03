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
  isDiscoverableAccountState,
  normalizeUsername,
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

// Helper to format a post for API response
async function formatPost(
  ctx: QueryCtx | MutationCtx,
  post: Doc<"posts">,
  currentUserId?: Id<"profiles">,
  options?: { author?: Doc<"profiles"> | null }
) {
  const author =
    options?.author !== undefined
      ? options.author
      : await ctx.db.get(post.authorId);

  // Use denormalized counts for O(1) performance
  const likesCount = post.likesCount ?? 0;
  const commentsCount = post.commentsCount ?? 0;

  // Check if current user liked this post
  let isLiked = false;
  if (currentUserId) {
    const likeLock = await getUniqueLock(
      ctx,
      "post_like",
      `${post._id}:${currentUserId}`
    );
    isLiked = !!likeLock;
  }

  const isDeleted = post.deletedAt != null;

  // Look up community data if post belongs to one
  let communityHandle: string | null = null;
  let communityThemeColor: string | null = null;
  if (post.communityId) {
    const community = await ctx.db.get(post.communityId);
    if (community) {
      communityHandle = community.handle;
      communityThemeColor = community.themeColor;
    }
  }

  return {
    id: post._id,
    author_id: post.authorId,
    text: isDeleted ? "" : (post.text ?? ""),
    audio_url: isDeleted ? null : resolvePublicMediaUrl({
      url: post.audioUrl,
      objectKey: post.audioObjectKey,
    }),
    audio_title: isDeleted ? null : (post.audioTitle ?? null),
    audio_duration: isDeleted ? null : (post.audioDuration ?? null),
    created_at: new Date(post._creationTime).toISOString(),
    author: author
      ? formatPublicProfileIdentity(author)
      : null,
    likes_count: likesCount,
    comments_count: commentsCount,
    is_liked: isLiked,
    deleted_at: post.deletedAt ?? null,
    community_id: post.communityId ?? null,
    community_handle: communityHandle,
    community_theme_color: communityThemeColor,
  };
}


/**
 * Create a new post
 * Equivalent to POST /posts
 */
export const create = mutation({
  args: {
    text: v.optional(v.string()),
    audio_url: v.optional(v.string()),
    audio_title: v.optional(v.string()),
    audio_duration: v.optional(v.number()),
    community_id: v.optional(v.id("communities")),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);

    // Rate limit: 5 posts per minute
    await checkRateLimit(ctx, "createPost", profile._id);

    // Sanitize and validate inputs
    const text = sanitizeText(args.text);
    const audioUrl = args.audio_url;
    const audioObjectKey = extractManagedMediaObjectKeyFromUrl(audioUrl);

    validateTextLength(text, MAX_LENGTHS.POST_TEXT, "Post text");
    validateUrl(audioUrl);

    // Text or audio must be provided
    if (!text && !audioUrl) {
      throw new Error("Post must have either text or audio");
    }

    // If posting to a community, verify membership
    if (args.community_id) {
      const membership = await ctx.db
        .query("community_members")
        .withIndex("by_community_and_profile", (q) =>
          q.eq("communityId", args.community_id!).eq("profileId", profile._id)
        )
        .first();
      if (!membership) {
        throw new Error("COMMUNITY_MEMBER_REQUIRED: You must be a member to post in this community");
      }
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

    const postId = await ctx.db.insert("posts", {
      authorId: profile._id,
      text: text,
      audioUrl: nextAudioUrl,
      audioObjectKey: nextAudioObjectKey,
      audioTitle: args.audio_title,
      audioDuration: args.audio_duration,
      communityId: args.community_id,
      likesCount: 0,
      commentsCount: 0,
      nextCommentSequence: 0, // Initialize atomic counter for comment path generation
    });

    // Increment community postsCount
    if (args.community_id) {
      const community = await ctx.db.get(args.community_id);
      if (community) {
        await ctx.db.patch(args.community_id, {
          postsCount: (community.postsCount ?? 0) + 1,
        });
      }
    }

    const post = await ctx.db.get(postId);
    if (!post) {
      throw new Error("Failed to create post");
    }

    return await formatPost(ctx, post, profile._id);
  },
});

/**
 * Get a post by ID
 * Equivalent to GET /posts/:postId
 */
export const getById = query({
  args: {
    postId: v.id("posts"),
  },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) {
      return null;
    }

    const currentProfile = await getCurrentProfile(ctx);
    return await formatPost(ctx, post, currentProfile?._id);
  },
});

/**
 * Get feed using native Convex pagination.
 * This is the preferred endpoint for Convex-first frontend pagination.
 */
export const getFeedPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const currentProfile = await getCurrentProfile(ctx);
    const result = await ctx.db
      .query("posts")
      .order("desc")
      .paginate(args.paginationOpts);

    const uniqueAuthorIds = [...new Set(result.page.map((post) => post.authorId))];
    const authorEntries = await Promise.all(
      uniqueAuthorIds.map(async (authorId) => [authorId, await ctx.db.get(authorId)] as const)
    );
    const authorMap = new Map(authorEntries);

    const page = await Promise.all(
      result.page.map((post) =>
        formatPost(ctx, post, currentProfile?._id, {
          author: authorMap.get(post.authorId) ?? null,
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
 * Get posts by username using native Convex pagination.
 * This is the preferred endpoint for Convex-first frontend pagination.
 */
export const getByUsernamePaginated = query({
  args: {
    username: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const currentProfile = await getCurrentProfile(ctx);
    const normalizedUsername = normalizeUsername(args.username) ?? args.username;
    const author = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", normalizedUsername))
      .first();

    if (!author) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    if (!isDiscoverableAccountState(author.accountState)) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const result = await ctx.db
      .query("posts")
      .withIndex("by_author", (q) => q.eq("authorId", author._id))
      .order("desc")
      .paginate(args.paginationOpts);

    const uniqueAuthorIds = [...new Set(result.page.map((post) => post.authorId))];
    const authorEntries = await Promise.all(
      uniqueAuthorIds.map(async (authorId) => [authorId, await ctx.db.get(authorId)] as const)
    );
    const authorMap = new Map(authorEntries);

    const page = await Promise.all(
      result.page.map((post) =>
        formatPost(ctx, post, currentProfile?._id, {
          author: authorMap.get(post.authorId) ?? null,
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
 * Delete a post (only owner can delete)
 * Equivalent to DELETE /posts/:postId
 */
export const remove = mutation({
  args: {
    postId: v.id("posts"),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);

    // Rate limit: 10 deletes per minute
    await checkRateLimit(ctx, "deleteAction", profile._id);

    const post = await ctx.db.get(args.postId);
    if (!post) {
      throw new Error("Post not found");
    }

    if (post.authorId !== profile._id) {
      throw new Error("You can only delete your own posts");
    }

    // Soft delete: mark deleted and clear content. The post document is kept so
    // existing links remain resolvable. Feed/profile show a placeholder.
    await ctx.db.patch(args.postId, {
      deletedAt: Date.now(),
      text: undefined,
      audioUrl: undefined,
      audioObjectKey: undefined,
    });

    return { message: "Post deleted successfully" };
  },
});

/**
 * Toggle like on a post
 * Equivalent to POST /posts/:postId/like
 */
export const toggleLike = mutation({
  args: {
    postId: v.id("posts"),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    
    // Rate limit: 30 likes per minute
    await checkRateLimit(ctx, "toggleLike", profile._id);

    const post = await ctx.db.get(args.postId);
    if (!post) {
      throw new Error("Post not found");
    }

    const lockValue = `${args.postId}:${profile._id}`;
    const existingLock = await getUniqueLock(ctx, "post_like", lockValue);

    if (existingLock) {
      // Unlike
      const existingLike = await ctx.db
        .query("post_likes")
        .withIndex("by_post_and_user", (q) =>
          q.eq("postId", args.postId).eq("userId", profile._id)
        )
        .first();
      if (existingLike) {
        await ctx.db.delete(existingLike._id);
      }
      await releaseUniqueLock(ctx, "post_like", lockValue);

      await ctx.db.patch(args.postId, {
        likesCount: Math.max(0, (post.likesCount ?? 0) - 1),
      });
    } else {
      const lockResult = await acquireUniqueLock(
        ctx,
        "post_like",
        lockValue,
        profile._id
      );

      // A racing like already acquired the lock; return current state.
      if (!lockResult.acquired) {
        const latest = await ctx.db.get(args.postId);
        if (!latest) {
          throw new Error("Post not found");
        }
        return await formatPost(ctx, latest, profile._id);
      }

      const existingLike = await ctx.db
        .query("post_likes")
        .withIndex("by_post_and_user", (q) =>
          q.eq("postId", args.postId).eq("userId", profile._id)
        )
        .first();
      if (!existingLike) {
        await ctx.db.insert("post_likes", {
          postId: args.postId,
          userId: profile._id,
        });
      }

      await ctx.db.patch(args.postId, {
        likesCount: (post.likesCount ?? 0) + 1,
      });
    }

    // Return updated post (refetch to get updated count)
    const updatedPost = await ctx.db.get(args.postId);
    return await formatPost(ctx, updatedPost!, profile._id);
  },
});

/**
 * Get posts for a specific community using native Convex pagination
 */
export const getCommunityPostsPaginated = query({
  args: {
    communityId: v.id("communities"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const currentProfile = await getCurrentProfile(ctx);
    const result = await ctx.db
      .query("posts")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .order("desc")
      .paginate(args.paginationOpts);

    const uniqueAuthorIds = [...new Set(result.page.map((post) => post.authorId))];
    const authorEntries = await Promise.all(
      uniqueAuthorIds.map(async (authorId) => [authorId, await ctx.db.get(authorId)] as const)
    );
    const authorMap = new Map(authorEntries);

    const page = await Promise.all(
      result.page.map((post) =>
        formatPost(ctx, post, currentProfile?._id, {
          author: authorMap.get(post.authorId) ?? null,
        })
      )
    );

    return { ...result, page };
  },
});

/**
 * Get users who liked a post
 * Equivalent to GET /posts/:postId/likes
 */
/**
 * Get users who liked a post
 * Supports cursor-based pagination using Convex .paginate()
 */
export const getLikes = query({
  args: {
    postId: v.id("posts"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("post_likes")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .order("desc")
      .paginate(args.paginationOpts);

    const users = await Promise.all(
      result.page.map(async (like) => {
        const user = await ctx.db.get(like.userId);
        if (!user) return null;
        return {
          ...formatPublicProfileIdentity(user),
          liked_at: new Date(like._creationTime).toISOString(),
        };
      })
    );

    return {
      ...result,
      page: users.filter(Boolean),
    };
  },
});

