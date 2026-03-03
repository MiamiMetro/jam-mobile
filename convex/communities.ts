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
  requireAuth,
  getCurrentProfile,
  formatPublicProfileIdentity,
  validateTextLength,
  sanitizeText,
  acquireUniqueLock,
  validateCommunityHandle,
  MAX_LENGTHS,
  MIN_LENGTHS,
} from "./helpers";
import { checkRateLimit } from "./rateLimiter";

// ============================================
// Community Constants
// ============================================

export const COMMUNITY_THEME_COLORS = [
  "amber",
  "purple",
  "blue",
  "green",
  "red",
  "pink",
  "teal",
  "indigo",
  "orange",
  "cyan",
] as const;

export type CommunityThemeColor = (typeof COMMUNITY_THEME_COLORS)[number];

export const COMMUNITY_TAGS = [
  "LoFi",
  "Rock",
  "Metal",
  "Electronic",
  "Jazz",
  "Hip Hop",
  "Indie",
  "Classical",
  "R&B",
  "Reggae",
  "Ambient",
  "House",
  "Pop",
  "Acoustic",
  "Beginner",
  "Collab",
  "Practice",
  "Late Night",
] as const;

export type CommunityTag = (typeof COMMUNITY_TAGS)[number];

const MAX_OWNED_COMMUNITIES = 3;
const MAX_COMMUNITY_TAGS = 5;

// ============================================
// Internal Format Helper
// ============================================

async function formatCommunity(
  ctx: QueryCtx | MutationCtx,
  community: Doc<"communities">,
  currentUserId?: Id<"profiles">
) {
  let memberRole: "owner" | "mod" | "member" | null = null;
  if (currentUserId) {
    const membership = await ctx.db
      .query("community_members")
      .withIndex("by_community_and_profile", (q) =>
        q.eq("communityId", community._id).eq("profileId", currentUserId)
      )
      .first();
    memberRole = membership?.role ?? null;
  }

  return {
    id: community._id,
    name: community.name,
    handle: community.handle,
    description: community.description ?? "",
    avatar_url: resolvePublicMediaUrl({
      url: community.avatarUrl,
      objectKey: community.avatarObjectKey,
    }),
    banner_url: resolvePublicMediaUrl({
      url: community.bannerUrl,
      objectKey: community.bannerObjectKey,
    }),
    theme_color: community.themeColor,
    tags: community.tags,
    owner_id: community.ownerId,
    members_count: community.membersCount,
    posts_count: community.postsCount,
    created_at: new Date(community.createdAt).toISOString(),
    member_role: memberRole,
  };
}

// ============================================
// Queries
// ============================================

/**
 * Get a community by its unique handle
 */
export const getByHandle = query({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const normalizedHandle = args.handle.trim().toLowerCase();
    const community = await ctx.db
      .query("communities")
      .withIndex("by_handle", (q) => q.eq("handle", normalizedHandle))
      .first();

    if (!community) return null;

    const currentProfile = await getCurrentProfile(ctx);
    return await formatCommunity(ctx, community, currentProfile?._id);
  },
});

/**
 * Get a community by its ID
 */
export const getById = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const community = await ctx.db.get(args.communityId);
    if (!community) return null;

    const currentProfile = await getCurrentProfile(ctx);
    return await formatCommunity(ctx, community, currentProfile?._id);
  },
});

/**
 * List communities with optional search/tag filter (paginated)
 */
export const listPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    tag: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentProfile = await getCurrentProfile(ctx);

    let result;
    if (args.search && args.search.trim().length > 0) {
      result = await ctx.db
        .query("communities")
        .withSearchIndex("search_communities", (q) =>
          q.search("name", args.search!.trim())
        )
        .paginate(args.paginationOpts);
    } else {
      result = await ctx.db
        .query("communities")
        .withIndex("by_created_at")
        .order("desc")
        .paginate(args.paginationOpts);
    }

    // Apply tag filter client-side (Convex doesn't support array field indexes)
    const filtered = args.tag
      ? result.page.filter((c) => c.tags.includes(args.tag!))
      : result.page;

    const page = await Promise.all(
      filtered.map((community) =>
        formatCommunity(ctx, community, currentProfile?._id)
      )
    );

    return { ...result, page };
  },
});

/**
 * Get communities the current user has joined (paginated)
 */
export const getJoined = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const currentProfile = await getCurrentProfile(ctx);
    if (!currentProfile) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const memberships = await ctx.db
      .query("community_members")
      .withIndex("by_profile", (q) => q.eq("profileId", currentProfile._id))
      .paginate(args.paginationOpts);

    const page = (
      await Promise.all(
        memberships.page.map(async (membership) => {
          const community = await ctx.db.get(membership.communityId);
          if (!community) return null;
          return formatCommunity(ctx, community, currentProfile._id);
        })
      )
    ).filter(Boolean) as Awaited<ReturnType<typeof formatCommunity>>[];

    return { ...memberships, page };
  },
});

/**
 * Get members of a community (paginated)
 */
export const getMembersPaginated = query({
  args: {
    communityId: v.id("communities"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("community_members")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .paginate(args.paginationOpts);

    const page = (
      await Promise.all(
        result.page.map(async (membership) => {
          const profile = await ctx.db.get(membership.profileId);
          if (!profile) return null;
          return {
            ...formatPublicProfileIdentity(profile),
            role: membership.role,
            joined_at: new Date(membership.joinedAt).toISOString(),
          };
        })
      )
    ).filter(Boolean);

    return { ...result, page };
  },
});

/**
 * Search members of a community by username (paginated)
 * For use in moderation panel
 */
export const searchMembersPaginated = query({
  args: {
    communityId: v.id("communities"),
    username: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    // Search profiles matching the username query
    const profileResults = await ctx.db
      .query("profiles")
      .withSearchIndex("search_profiles", (q) =>
        q.search("username", args.username.trim())
      )
      .paginate(args.paginationOpts);

    // Cross-check membership for each profile
    const page = (
      await Promise.all(
        profileResults.page.map(async (profile) => {
          const membership = await ctx.db
            .query("community_members")
            .withIndex("by_community_and_profile", (q) =>
              q
                .eq("communityId", args.communityId)
                .eq("profileId", profile._id)
            )
            .first();
          if (!membership) return null;
          return {
            ...formatPublicProfileIdentity(profile),
            role: membership.role,
            joined_at: new Date(membership.joinedAt).toISOString(),
          };
        })
      )
    ).filter(Boolean);

    return { ...profileResults, page };
  },
});

/**
 * Get the current user's role in a community
 * Returns null if not a member
 */
export const getMemberRole = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const currentProfile = await getCurrentProfile(ctx);
    if (!currentProfile) return null;

    const membership = await ctx.db
      .query("community_members")
      .withIndex("by_community_and_profile", (q) =>
        q
          .eq("communityId", args.communityId)
          .eq("profileId", currentProfile._id)
      )
      .first();

    return membership?.role ?? null;
  },
});

/**
 * Get count of communities owned by the current user
 */
export const getCreatedCount = query({
  args: {},
  handler: async (ctx) => {
    const currentProfile = await getCurrentProfile(ctx);
    if (!currentProfile) return 0;

    const owned = await ctx.db
      .query("communities")
      .withIndex("by_owner", (q) => q.eq("ownerId", currentProfile._id))
      .collect();

    return owned.length;
  },
});

// ============================================
// Mutations
// ============================================

/**
 * Create a new community
 * Users can own at most 3 communities
 */
export const create = mutation({
  args: {
    name: v.string(),
    handle: v.string(),
    description: v.optional(v.string()),
    themeColor: v.string(),
    tags: v.array(v.string()),
    avatar_url: v.optional(v.string()),
    banner_url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "createCommunity", profile._id);

    // Validate handle
    const normalizedHandle = validateCommunityHandle(args.handle);

    // Validate name
    const name = sanitizeText(args.name) ?? "";
    if (name.length < MIN_LENGTHS.COMMUNITY_NAME) {
      throw new Error(`COMMUNITY_NAME_TOO_SHORT: Name must be at least ${MIN_LENGTHS.COMMUNITY_NAME} characters`);
    }
    validateTextLength(name, MAX_LENGTHS.COMMUNITY_NAME, "Community name");

    // Validate description
    const description = sanitizeText(args.description);
    validateTextLength(description, MAX_LENGTHS.COMMUNITY_DESCRIPTION, "Description");

    // Validate theme color
    if (!(COMMUNITY_THEME_COLORS as readonly string[]).includes(args.themeColor)) {
      throw new Error("INVALID_THEME_COLOR: Invalid theme color");
    }

    // Validate tags
    if (args.tags.length > MAX_COMMUNITY_TAGS) {
      throw new Error(`TAG_LIMIT: Maximum ${MAX_COMMUNITY_TAGS} tags allowed`);
    }
    for (const tag of args.tags) {
      validateTextLength(tag, MAX_LENGTHS.COMMUNITY_TAG, "Tag");
    }

    // Check owned community count
    const owned = await ctx.db
      .query("communities")
      .withIndex("by_owner", (q) => q.eq("ownerId", profile._id))
      .collect();
    if (owned.length >= MAX_OWNED_COMMUNITIES) {
      throw new Error(`COMMUNITY_LIMIT_REACHED: You can own at most ${MAX_OWNED_COMMUNITIES} communities`);
    }

    // Acquire unique lock for handle
    const lockResult = await acquireUniqueLock(
      ctx,
      "community_handle",
      normalizedHandle,
      profile._id
    );
    if (!lockResult.acquired) {
      throw new Error("HANDLE_TAKEN: This handle is already in use");
    }

    // Handle avatar upload session
    let avatarUrl = args.avatar_url;
    let avatarObjectKey: string | undefined;
    const avatarObjKey = extractManagedMediaObjectKeyFromUrl(avatarUrl);
    if (avatarUrl && avatarObjKey) {
      const session = await consumeReadyUploadSessionByPublicUrl(ctx, {
        ownerProfileId: profile._id,
        publicUrl: avatarUrl,
        kind: "avatar",
      });
      avatarObjectKey = session.objectKey;
      avatarUrl = undefined;
    }

    // Handle banner upload session
    let bannerUrl = args.banner_url;
    let bannerObjectKey: string | undefined;
    const bannerObjKey = extractManagedMediaObjectKeyFromUrl(bannerUrl);
    if (bannerUrl && bannerObjKey) {
      const session = await consumeReadyUploadSessionByPublicUrl(ctx, {
        ownerProfileId: profile._id,
        publicUrl: bannerUrl,
        kind: "banner",
      });
      bannerObjectKey = session.objectKey;
      bannerUrl = undefined;
    }

    const communityId = await ctx.db.insert("communities", {
      name,
      handle: normalizedHandle,
      description,
      avatarUrl,
      avatarObjectKey,
      bannerUrl,
      bannerObjectKey,
      themeColor: args.themeColor,
      tags: args.tags,
      ownerId: profile._id,
      membersCount: 1,
      postsCount: 0,
      createdAt: Date.now(),
    });

    // Add owner as a member
    await ctx.db.insert("community_members", {
      communityId,
      profileId: profile._id,
      role: "owner",
      joinedAt: Date.now(),
    });

    const community = await ctx.db.get(communityId);
    if (!community) throw new Error("Failed to create community");

    return await formatCommunity(ctx, community, profile._id);
  },
});

/**
 * Update community settings (owner only)
 */
export const update = mutation({
  args: {
    communityId: v.id("communities"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    themeColor: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    avatar_url: v.optional(v.string()),
    banner_url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "updateCommunity", profile._id);

    const community = await ctx.db.get(args.communityId);
    if (!community) throw new Error("Community not found");
    if (community.ownerId !== profile._id) {
      throw new Error("UNAUTHORIZED: Only the owner can edit this community");
    }

    const patch: Partial<Doc<"communities">> = {};

    if (args.name !== undefined) {
      const name = sanitizeText(args.name) ?? "";
      if (name.length < MIN_LENGTHS.COMMUNITY_NAME) {
        throw new Error(`COMMUNITY_NAME_TOO_SHORT: Name must be at least ${MIN_LENGTHS.COMMUNITY_NAME} characters`);
      }
      validateTextLength(name, MAX_LENGTHS.COMMUNITY_NAME, "Community name");
      patch.name = name;
    }

    if (args.description !== undefined) {
      const description = sanitizeText(args.description);
      validateTextLength(description, MAX_LENGTHS.COMMUNITY_DESCRIPTION, "Description");
      patch.description = description;
    }

    if (args.themeColor !== undefined) {
      if (!(COMMUNITY_THEME_COLORS as readonly string[]).includes(args.themeColor)) {
        throw new Error("INVALID_THEME_COLOR: Invalid theme color");
      }
      patch.themeColor = args.themeColor;
    }

    if (args.tags !== undefined) {
      if (args.tags.length > MAX_COMMUNITY_TAGS) {
        throw new Error(`TAG_LIMIT: Maximum ${MAX_COMMUNITY_TAGS} tags allowed`);
      }
      for (const tag of args.tags) {
        validateTextLength(tag, MAX_LENGTHS.COMMUNITY_TAG, "Tag");
      }
      patch.tags = args.tags;
    }

    // Handle avatar update
    if (args.avatar_url !== undefined) {
      const avatarObjKey = extractManagedMediaObjectKeyFromUrl(args.avatar_url);
      if (args.avatar_url && avatarObjKey) {
        const session = await consumeReadyUploadSessionByPublicUrl(ctx, {
          ownerProfileId: profile._id,
          publicUrl: args.avatar_url,
          kind: "avatar",
        });
        patch.avatarObjectKey = session.objectKey;
        patch.avatarUrl = undefined;
      } else if (args.avatar_url === "") {
        patch.avatarUrl = undefined;
        patch.avatarObjectKey = undefined;
      } else {
        patch.avatarUrl = args.avatar_url;
        patch.avatarObjectKey = undefined;
      }
    }

    // Handle banner update
    if (args.banner_url !== undefined) {
      const bannerObjKey = extractManagedMediaObjectKeyFromUrl(args.banner_url);
      if (args.banner_url && bannerObjKey) {
        const session = await consumeReadyUploadSessionByPublicUrl(ctx, {
          ownerProfileId: profile._id,
          publicUrl: args.banner_url,
          kind: "banner",
        });
        patch.bannerObjectKey = session.objectKey;
        patch.bannerUrl = undefined;
      } else if (args.banner_url === "") {
        patch.bannerUrl = undefined;
        patch.bannerObjectKey = undefined;
      } else {
        patch.bannerUrl = args.banner_url;
        patch.bannerObjectKey = undefined;
      }
    }

    await ctx.db.patch(args.communityId, patch);

    const updated = await ctx.db.get(args.communityId);
    if (!updated) throw new Error("Community not found after update");

    return await formatCommunity(ctx, updated, profile._id);
  },
});

/**
 * Join a community
 */
export const join = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "joinCommunity", profile._id);

    const community = await ctx.db.get(args.communityId);
    if (!community) throw new Error("Community not found");

    // Check if already a member
    const existing = await ctx.db
      .query("community_members")
      .withIndex("by_community_and_profile", (q) =>
        q.eq("communityId", args.communityId).eq("profileId", profile._id)
      )
      .first();

    if (existing) {
      throw new Error("ALREADY_MEMBER: You are already a member of this community");
    }

    await ctx.db.insert("community_members", {
      communityId: args.communityId,
      profileId: profile._id,
      role: "member",
      joinedAt: Date.now(),
    });

    await ctx.db.patch(args.communityId, {
      membersCount: community.membersCount + 1,
    });

    const updated = await ctx.db.get(args.communityId);
    return await formatCommunity(ctx, updated!, profile._id);
  },
});

/**
 * Leave a community (owners cannot leave — they must delete the community)
 */
export const leave = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);

    const membership = await ctx.db
      .query("community_members")
      .withIndex("by_community_and_profile", (q) =>
        q.eq("communityId", args.communityId).eq("profileId", profile._id)
      )
      .first();

    if (!membership) throw new Error("NOT_MEMBER: You are not a member of this community");

    if (membership.role === "owner") {
      throw new Error("OWNER_CANNOT_LEAVE: The owner cannot leave the community");
    }

    await ctx.db.delete(membership._id);

    const community = await ctx.db.get(args.communityId);
    if (community) {
      await ctx.db.patch(args.communityId, {
        membersCount: Math.max(0, community.membersCount - 1),
      });
    }

    return { success: true };
  },
});

/**
 * Promote a member to mod (owner only)
 */
export const promoteMod = mutation({
  args: {
    communityId: v.id("communities"),
    profileId: v.id("profiles"),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "communityModAction", profile._id);

    // Verify caller is owner
    const callerMembership = await ctx.db
      .query("community_members")
      .withIndex("by_community_and_profile", (q) =>
        q.eq("communityId", args.communityId).eq("profileId", profile._id)
      )
      .first();

    if (callerMembership?.role !== "owner") {
      throw new Error("UNAUTHORIZED: Only the owner can promote members to mod");
    }

    // Find target membership
    const targetMembership = await ctx.db
      .query("community_members")
      .withIndex("by_community_and_profile", (q) =>
        q.eq("communityId", args.communityId).eq("profileId", args.profileId)
      )
      .first();

    if (!targetMembership) throw new Error("NOT_MEMBER: Target user is not a member");
    if (targetMembership.role !== "member") {
      throw new Error("INVALID_ROLE: User must be a regular member to be promoted");
    }

    await ctx.db.patch(targetMembership._id, { role: "mod" });
    return { success: true };
  },
});

/**
 * Demote a mod back to member (owner only)
 */
export const demoteMod = mutation({
  args: {
    communityId: v.id("communities"),
    profileId: v.id("profiles"),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "communityModAction", profile._id);

    // Verify caller is owner
    const callerMembership = await ctx.db
      .query("community_members")
      .withIndex("by_community_and_profile", (q) =>
        q.eq("communityId", args.communityId).eq("profileId", profile._id)
      )
      .first();

    if (callerMembership?.role !== "owner") {
      throw new Error("UNAUTHORIZED: Only the owner can demote mods");
    }

    // Find target membership
    const targetMembership = await ctx.db
      .query("community_members")
      .withIndex("by_community_and_profile", (q) =>
        q.eq("communityId", args.communityId).eq("profileId", args.profileId)
      )
      .first();

    if (!targetMembership) throw new Error("NOT_MEMBER: Target user is not a member");
    if (targetMembership.role !== "mod") {
      throw new Error("INVALID_ROLE: User must be a mod to be demoted");
    }

    await ctx.db.patch(targetMembership._id, { role: "member" });
    return { success: true };
  },
});

/**
 * Remove a member from a community
 * Owners can remove any non-owner member; mods can only remove regular members
 */
export const removeMember = mutation({
  args: {
    communityId: v.id("communities"),
    profileId: v.id("profiles"),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "communityModAction", profile._id);

    // Verify caller membership
    const callerMembership = await ctx.db
      .query("community_members")
      .withIndex("by_community_and_profile", (q) =>
        q.eq("communityId", args.communityId).eq("profileId", profile._id)
      )
      .first();

    if (!callerMembership || (callerMembership.role !== "owner" && callerMembership.role !== "mod")) {
      throw new Error("UNAUTHORIZED: Only owners and mods can remove members");
    }

    // Find target membership
    const targetMembership = await ctx.db
      .query("community_members")
      .withIndex("by_community_and_profile", (q) =>
        q.eq("communityId", args.communityId).eq("profileId", args.profileId)
      )
      .first();

    if (!targetMembership) throw new Error("NOT_MEMBER: Target user is not a member");

    if (targetMembership.role === "owner") {
      throw new Error("CANNOT_REMOVE_OWNER: The owner cannot be removed");
    }

    // Mods can only remove regular members (not other mods)
    if (callerMembership.role === "mod" && targetMembership.role === "mod") {
      throw new Error("UNAUTHORIZED: Mods cannot remove other mods");
    }

    await ctx.db.delete(targetMembership._id);

    const community = await ctx.db.get(args.communityId);
    if (community) {
      await ctx.db.patch(args.communityId, {
        membersCount: Math.max(0, community.membersCount - 1),
      });
    }

    return { success: true };
  },
});
