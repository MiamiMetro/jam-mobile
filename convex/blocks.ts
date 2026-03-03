import { query, mutation } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { formatPublicProfileIdentity, requireAuth } from "./helpers";
import { checkRateLimit } from "./rateLimiter";

/**
 * Block a user
 * Equivalent to POST /blocks/:userId
 */
export const block = mutation({
  args: {
    userId: v.id("profiles"),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "blockAction", profile._id);

    // Cannot block self
    if (profile._id === args.userId) {
      throw new Error("You cannot block yourself");
    }

    // Check if user exists
    const userToBlock = await ctx.db.get(args.userId);
    if (!userToBlock) {
      throw new Error("User not found");
    }

    // Check if already blocked
    const existingBlock = await ctx.db
      .query("blocks")
      .withIndex("by_blocker_and_blocked", (q) =>
        q.eq("blockerId", profile._id).eq("blockedId", args.userId)
      )
      .first();

    if (existingBlock) {
      throw new Error("User already blocked");
    }

    // Create block
    const blockId = await ctx.db.insert("blocks", {
      blockerId: profile._id,
      blockedId: args.userId,
    });

    const block = await ctx.db.get(blockId);

    return {
      id: block!._id,
      blocker_id: block!.blockerId,
      blocked_id: block!.blockedId,
      created_at: new Date(block!._creationTime).toISOString(),
    };
  },
});

/**
 * Unblock a user
 * Equivalent to DELETE /blocks/:userId
 */
export const unblock = mutation({
  args: {
    userId: v.id("profiles"),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "blockAction", profile._id);

    // Find the block
    const block = await ctx.db
      .query("blocks")
      .withIndex("by_blocker_and_blocked", (q) =>
        q.eq("blockerId", profile._id).eq("blockedId", args.userId)
      )
      .first();

    if (!block) {
      throw new Error("Block not found");
    }

    await ctx.db.delete(block._id);

    return { message: "User unblocked successfully" };
  },
});

/**
 * Get list of blocked users using native Convex pagination.
 * This is the preferred endpoint for Convex-first frontend pagination.
 */
export const listPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    const result = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", profile._id))
      .order("desc")
      .paginate(args.paginationOpts);

    const page = await Promise.all(
      result.page.map(async (block) => {
        const blocked = await ctx.db.get(block.blockedId);
        if (!blocked) return null;
        return {
          ...formatPublicProfileIdentity(blocked),
          blocked_at: new Date(block._creationTime).toISOString(),
        };
      })
    );

    return {
      ...result,
      page: page.filter(Boolean),
    };
  },
});

