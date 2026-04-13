import { query, mutation } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  formatPublicProfileIdentity,
  getCurrentProfile,
  isDiscoverableAccountState,
  requireAuth,
} from "./helpers";
import { checkRateLimit } from "./rateLimiter";

/**
 * Send a friend request
 * Equivalent to POST /friends/:userId/request
 */
export const sendRequest = mutation({
  args: {
    friendId: v.id("profiles"),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    
    // Rate limit: 10 friend requests per minute
    await checkRateLimit(ctx, "friendRequest", profile._id);

    // Cannot send request to self
    if (profile._id === args.friendId) {
      throw new Error("You cannot send friend request to yourself");
    }

    // Check if friend exists
    const friend = await ctx.db.get(args.friendId);
    if (!friend) {
      throw new Error("User not found");
    }
    if (!isDiscoverableAccountState(friend.accountState)) {
      throw new Error("This user is not available for friend requests");
    }

    // Check if friendship already exists (in either direction)
    const existing1 = await ctx.db
      .query("friends")
      .withIndex("by_user_and_friend", (q) =>
        q.eq("userId", profile._id).eq("friendId", args.friendId)
      )
      .first();

    const existing2 = await ctx.db
      .query("friends")
      .withIndex("by_user_and_friend", (q) =>
        q.eq("userId", args.friendId).eq("friendId", profile._id)
      )
      .first();

    if (existing1) {
      if (existing1.status === "accepted") {
        throw new Error("Users are already friends");
      }
      throw new Error("Friend request already sent");
    }

    if (existing2) {
      if (existing2.status === "accepted") {
        throw new Error("Users are already friends");
      }
      // The other user sent a request, accept it and ensure bidirectional records
      await ctx.db.patch(existing2._id, { status: "accepted" });

      const mirror = await ctx.db
        .query("friends")
        .withIndex("by_user_and_friend", (q) =>
          q.eq("userId", profile._id).eq("friendId", args.friendId)
        )
        .first();

      if (mirror) {
        if (mirror.status !== "accepted") {
          await ctx.db.patch(mirror._id, { status: "accepted" });
        }
      } else {
        await ctx.db.insert("friends", {
          userId: profile._id,
          friendId: args.friendId,
          status: "accepted",
        });
      }

      return { message: "Friend request accepted", status: "accepted" };
    }

    // Create friend request
    await ctx.db.insert("friends", {
      userId: profile._id,
      friendId: args.friendId,
      status: "pending",
    });

    return { message: "Friend request sent", status: "pending" };
  },
});

/**
 * Accept a friend request
 * Equivalent to POST /friends/:userId/accept
 * Creates bidirectional friendship records
 */
export const acceptRequest = mutation({
  args: {
    userId: v.id("profiles"),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);

    // Rate limit: 10 friend actions per minute
    await checkRateLimit(ctx, "friendRequest", profile._id);

    // Find pending request where args.userId is the requester
    const request = await ctx.db
      .query("friends")
      .withIndex("by_user_and_friend", (q) =>
        q.eq("userId", args.userId).eq("friendId", profile._id)
      )
      .first();

    if (!request) {
      throw new Error("Friend request not found");
    }

    if (request.status !== "pending") {
      throw new Error("Friend request is not pending");
    }

    // Update original request to accepted
    await ctx.db.patch(request._id, { status: "accepted" });

    // Create mirror record for bidirectional lookup
    // This allows O(1) friend checks without querying both directions
    const existingMirror = await ctx.db
      .query("friends")
      .withIndex("by_user_and_friend", (q) =>
        q.eq("userId", profile._id).eq("friendId", args.userId)
      )
      .first();

    if (!existingMirror) {
      await ctx.db.insert("friends", {
        userId: profile._id,
        friendId: args.userId,
        status: "accepted",
      });
    } else if (existingMirror.status !== "accepted") {
      await ctx.db.patch(existingMirror._id, { status: "accepted" });
    }
    return { message: "Friend request accepted", status: "accepted" };
  },
});

/**
 * Remove a friend or cancel a friend request
 * Equivalent to DELETE /friends/:userId
 * For accepted friendships, deletes both bidirectional records
 */
export const remove = mutation({
  args: {
    userId: v.id("profiles"),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);

    // Rate limit: 10 friend actions per minute
    await checkRateLimit(ctx, "friendRequest", profile._id);

    // Find friendship in both directions
    const friendship1 = await ctx.db
      .query("friends")
      .withIndex("by_user_and_friend", (q) =>
        q.eq("userId", profile._id).eq("friendId", args.userId)
      )
      .first();

    const friendship2 = await ctx.db
      .query("friends")
      .withIndex("by_user_and_friend", (q) =>
        q.eq("userId", args.userId).eq("friendId", profile._id)
      )
      .first();

    if (!friendship1 && !friendship2) {
      throw new Error("Friendship not found");
    }

    // Delete both records (for accepted friendships, both exist)
    // For pending requests, only one exists
    if (friendship1) {
      await ctx.db.delete(friendship1._id);
    }
    if (friendship2) {
      await ctx.db.delete(friendship2._id);
    }

    return { message: "Friend removed successfully" };
  },
});

/**
 * Get friends list using native Convex pagination.
 * This is the preferred endpoint for Convex-first frontend pagination.
 * For search, this endpoint scans accepted friendships page-by-page until
 * it fills the requested page size with matches, so results are not limited
 * to only the first loaded friendship page.
 */
export const getCount = query({
  args: { userId: v.id("profiles") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("friends")
      .withIndex("by_user_and_status", (q) =>
        q.eq("userId", args.userId).eq("status", "accepted")
      )
      .collect();
    return rows.length;
  },
});

export const listPaginated = query({
  args: {
    userId: v.optional(v.id("profiles")),
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    let targetUserId: Id<"profiles"> | null = args.userId ?? null;
    if (!targetUserId) {
      const profile = await getCurrentProfile(ctx);
      if (!profile) {
        return { page: [], isDone: true, continueCursor: "" };
      }
      targetUserId = profile._id;
    }

    const searchLower = args.search?.trim().toLowerCase();
    const friendshipsQuery = () =>
      ctx.db
        .query("friends")
        .withIndex("by_user_and_status", (q) =>
          q.eq("userId", targetUserId).eq("status", "accepted")
        )
        .order("desc");

    if (!searchLower) {
      const result = await friendshipsQuery().paginate(args.paginationOpts);
      const page = await Promise.all(
        result.page.map(async (friendship) => {
          const friend = await ctx.db.get(friendship.friendId);
          if (!friend) return null;
          return {
            ...formatPublicProfileIdentity(friend),
            friends_since: new Date(friendship._creationTime).toISOString(),
          };
        })
      );

      return {
        ...result,
        page: page.filter(
          (
            friend
          ): friend is NonNullable<(typeof page)[number]> => friend !== null
        ),
      };
    }

    let cursor = args.paginationOpts.cursor;
    let isDone = false;
    const page: Array<{
      id: Id<"profiles">;
      username: string;
      display_name: string;
      avatar_url: string;
      friends_since: string;
    }> = [];

    while (page.length < args.paginationOpts.numItems && !isDone) {
      const remaining = args.paginationOpts.numItems - page.length;
      const batch = await friendshipsQuery().paginate({
        cursor,
        numItems: remaining,
      });
      cursor = batch.continueCursor;
      isDone = batch.isDone;

      const matchedFriends = await Promise.all(
        batch.page.map(async (friendship) => {
          const friend = await ctx.db.get(friendship.friendId);
          if (!friend) return null;
          if (
            !friend.username.toLowerCase().includes(searchLower) &&
            !(friend.displayName ?? "").toLowerCase().includes(searchLower)
          ) {
            return null;
          }
          return {
            ...formatPublicProfileIdentity(friend),
            friends_since: new Date(friendship._creationTime).toISOString(),
          };
        })
      );

      for (const friend of matchedFriends) {
        if (friend) page.push(friend);
      }
    }

    return {
      page,
      isDone,
      continueCursor: cursor ?? "",
    };
  },
});

/**
 * Get pending friend requests using native Convex pagination.
 * This is the preferred endpoint for Convex-first frontend pagination.
 */
export const getRequestsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const profile = await getCurrentProfile(ctx);
    if (!profile) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const result = await ctx.db
      .query("friends")
      .withIndex("by_friend_and_status", (q) =>
        q.eq("friendId", profile._id).eq("status", "pending")
      )
      .order("desc")
      .paginate(args.paginationOpts);

    const page = await Promise.all(
      result.page.map(async (request) => {
        const user = await ctx.db.get(request.userId);
        if (!user) return null;
        return {
          ...formatPublicProfileIdentity(user),
          requested_at: new Date(request._creationTime).toISOString(),
        };
      })
    );

    return {
      ...result,
      page: page.filter(Boolean),
    };
  },
});

/**
 * Get sent pending requests with recipient user data using native Convex pagination.
 * This is the preferred endpoint for Convex-first frontend pagination.
 */
/**
 * Get suggested friends: recent active users who are not already
 * friends or pending with the current user.
 * Returns up to `limit` suggestions (default 5).
 */
export const getSuggested = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const profile = await getCurrentProfile(ctx);
    if (!profile) return [];

    const limit = args.limit ?? 5;

    // Collect all user IDs we should exclude (self + any friend/pending relationship)
    const excludeIds = new Set<string>([profile._id]);

    const myFriendships = await ctx.db
      .query("friends")
      .withIndex("by_user", (q) => q.eq("userId", profile._id))
      .collect();
    for (const f of myFriendships) {
      excludeIds.add(f.friendId);
    }

    const incomingFriendships = await ctx.db
      .query("friends")
      .withIndex("by_friend", (q) => q.eq("friendId", profile._id))
      .collect();
    for (const f of incomingFriendships) {
      excludeIds.add(f.userId);
    }

    // Also exclude blocked users (both directions)
    const blockedByMe = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", profile._id))
      .collect();
    for (const b of blockedByMe) {
      excludeIds.add(b.blockedId);
    }

    const blockedMe = await ctx.db
      .query("blocks")
      .withIndex("by_blocked", (q) => q.eq("blockedId", profile._id))
      .collect();
    for (const b of blockedMe) {
      excludeIds.add(b.blockerId);
    }

    // Scan recent profiles and pick first `limit` not in excludeIds
    const suggestions: Array<{
      id: string;
      username: string;
      display_name: string;
      avatar_url: string;
    }> = [];

    // Take a reasonable batch to filter from (50 should be plenty for small app)
    const candidates = await ctx.db
      .query("profiles")
      .order("desc")
      .take(50);

    for (const candidate of candidates) {
      if (suggestions.length >= limit) break;
      if (excludeIds.has(candidate._id)) continue;
      if (!isDiscoverableAccountState(candidate.accountState)) continue;

      suggestions.push(formatPublicProfileIdentity(candidate));
    }

    return suggestions;
  },
});

export const getSentRequestsWithDataPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const profile = await getCurrentProfile(ctx);
    if (!profile) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const result = await ctx.db
      .query("friends")
      .withIndex("by_user_and_status", (q) =>
        q.eq("userId", profile._id).eq("status", "pending")
      )
      .order("desc")
      .paginate(args.paginationOpts);

    const page = await Promise.all(
      result.page.map(async (request) => {
        const user = await ctx.db.get(request.friendId);
        if (!user) return null;
        return {
          ...formatPublicProfileIdentity(user),
          requested_at: new Date(request._creationTime).toISOString(),
        };
      })
    );

    return {
      ...result,
      page: page.filter(Boolean),
    };
  },
});


