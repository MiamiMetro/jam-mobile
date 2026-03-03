import { query, mutation } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import {
  requireAuth,
  getCurrentProfile,
  formatPublicProfileIdentity,
  validateTextLength,
  sanitizeText,
  validateRoomHandle,
  validateUrl,
  areFriends,
  acquireUniqueLock,
  releaseUniqueLock,
  MAX_LENGTHS,
  MIN_LENGTHS,
} from "./helpers";
import { checkRateLimit } from "./rateLimiter";
import { Presence } from "@convex-dev/presence";
import { components } from "./_generated/api";

const presence = new Presence(components.presence);

// ============================================
// Room Constants
// ============================================

const MOCK_STREAM_URL =
  "https://virtual-channel.unified-streaming.com/demo_channel-stable.isml/.m3u8";

import { ROOM_GENRES } from "./shared";
export { ROOM_GENRES, type RoomGenre } from "./shared";

/** Presence room ID for a jam room */
function roomPresenceId(roomId: string) {
  return `room:${roomId}`;
}

// ============================================
// Internal Format Helper
// ============================================

async function formatRoom(ctx: QueryCtx | MutationCtx, room: Doc<"rooms">) {
  const host = await ctx.db.get(room.hostId);

  // Get live participant count from presence
  const onlineUsers = await presence.listRoom(
    ctx,
    roomPresenceId(String(room._id)),
    true
  );

  return {
    id: room._id,
    host_id: room.hostId,
    host: host ? formatPublicProfileIdentity(host) : null,
    handle: room.handle,
    name: room.name,
    description: room.description ?? "",
    genre: room.genre ?? null,
    max_performers: room.maxPerformers,
    is_private: room.isPrivate,
    is_active: room.isActive,
    stream_url: room.streamUrl ?? null,
    status: room.status,
    community_id: room.communityId ?? null,
    participant_count: onlineUsers.length,
    last_active_at: new Date(room.lastActiveAt).toISOString(),
    created_at: new Date(room._creationTime).toISOString(),
  };
}

// ============================================
// Queries
// ============================================

/** Get a room by its unique handle */
export const getByHandle = query({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const normalizedHandle = args.handle.trim().toLowerCase();
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_handle", (q) => q.eq("handle", normalizedHandle))
      .first();

    if (!room) return null;
    return await formatRoom(ctx, room);
  },
});

/** Get the current user's room (each user can host at most 1) */
export const getMyRoom = query({
  args: {},
  handler: async (ctx) => {
    const currentProfile = await getCurrentProfile(ctx);
    if (!currentProfile) return null;

    const room = await ctx.db
      .query("rooms")
      .withIndex("by_host", (q) => q.eq("hostId", currentProfile._id))
      .first();

    if (!room) return null;
    return await formatRoom(ctx, room);
  },
});

/** List active rooms with optional genre/search filter (paginated) */
export const listActivePaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    genre: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("rooms")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .order("desc")
      .paginate(args.paginationOpts);

    let filtered = result.page;

    if (args.genre && args.genre.trim().length > 0) {
      const genre = args.genre.trim();
      filtered = filtered.filter((r) => r.genre === genre);
    }

    if (args.search && args.search.trim().length > 0) {
      const searchLower = args.search.trim().toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.name.toLowerCase().includes(searchLower) ||
          (r.description ?? "").toLowerCase().includes(searchLower) ||
          r.handle.toLowerCase().includes(searchLower)
      );
    }

    const page = await Promise.all(filtered.map((room) => formatRoom(ctx, room)));
    return { ...result, page };
  },
});

const MAX_PARTICIPANTS_RETURNED = 100;

/** Get participants of a room via presence (capped at 100) */
export const getParticipants = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room || !room.isActive) return { participants: [], total_count: 0 };

    // Private room: only friends of host (or host) can see participants
    if (room.isPrivate) {
      const profile = await getCurrentProfile(ctx);
      if (!profile) return { participants: [], total_count: 0 };
      if (profile._id !== room.hostId) {
        const friends = await areFriends(ctx, profile._id, room.hostId);
        if (!friends) return { participants: [], total_count: 0 };
      }
    }

    const onlineUsers = await presence.listRoom(
      ctx,
      roomPresenceId(String(args.roomId)),
      true
    );

    const totalCount = onlineUsers.length;
    const capped = onlineUsers
      .filter((u) => u.userId)
      .slice(0, MAX_PARTICIPANTS_RETURNED);

    const participants = await Promise.all(
      capped.map(async (u) => {
        const isGuest = (u.userId as string).startsWith("guest:");
        if (isGuest) {
          return {
            profile_id: u.userId,
            profile: {
              id: u.userId,
              username: "Guest",
              display_name: "Guest",
              avatar_url: "",
            },
            role: "listener" as const,
            is_guest: true,
          };
        }
        const profile = await ctx.db.get(u.userId as Id<"profiles">);
        return {
          profile_id: u.userId,
          profile: profile ? formatPublicProfileIdentity(profile) : null,
          role: "listener" as const,
          is_guest: false,
        };
      })
    );

    return {
      participants: participants.filter((p) => p.profile !== null),
      total_count: totalCount,
    };
  },
});

/** Get friends who are currently in active rooms via presence */
export const getFriendsInRooms = query({
  args: {},
  handler: async (ctx) => {
    const currentProfile = await getCurrentProfile(ctx);
    if (!currentProfile) return [];

    const friendships = await ctx.db
      .query("friends")
      .withIndex("by_user_and_status", (q) =>
        q.eq("userId", currentProfile._id).eq("status", "accepted")
      )
      .collect();

    if (friendships.length === 0) return [];

    const results: Array<{
      friend: ReturnType<typeof formatPublicProfileIdentity>;
      room_id: string;
      room_handle: string;
      room_name: string;
      role: string;
    }> = [];

    for (const friendship of friendships) {
      // Check all presence rooms this friend is in
      const userRooms = await presence.listUser(
        ctx,
        String(friendship.friendId),
        true
      );

      // Find a room: presence room starting with "room:"
      const roomPresence = userRooms.find(
        (r) => r.roomId.startsWith("room:") && r.online
      );
      if (!roomPresence) continue;

      // Extract the actual room ID from "room:{id}"
      const actualRoomId = roomPresence.roomId.replace("room:", "") as Id<"rooms">;
      const room = await ctx.db.get(actualRoomId);
      if (!room || !room.isActive) continue;

      const friendProfile = await ctx.db.get(friendship.friendId);
      if (!friendProfile) continue;

      results.push({
        friend: formatPublicProfileIdentity(friendProfile),
        room_id: String(room._id),
        room_handle: room.handle,
        room_name: room.name,
        role: "listener",
      });
    }

    return results;
  },
});

// ============================================
// Mutations
// ============================================

/** Create a new room — one per user, unique handle */
export const create = mutation({
  args: {
    handle: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    genre: v.optional(v.string()),
    maxPerformers: v.optional(v.number()),
    isPrivate: v.optional(v.boolean()),
    communityId: v.optional(v.id("communities")),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "roomCreate", profile._id);

    const existingRoom = await ctx.db
      .query("rooms")
      .withIndex("by_host", (q) => q.eq("hostId", profile._id))
      .first();
    if (existingRoom) {
      throw new Error("ROOM_LIMIT_REACHED: You can only host one room at a time");
    }

    const normalizedHandle = validateRoomHandle(args.handle);

    const name = sanitizeText(args.name) ?? "";
    if (name.length < MIN_LENGTHS.ROOM_NAME) {
      throw new Error(
        `ROOM_NAME_TOO_SHORT: Name must be at least ${MIN_LENGTHS.ROOM_NAME} characters`
      );
    }
    validateTextLength(name, MAX_LENGTHS.ROOM_NAME, "Room name");

    const description = sanitizeText(args.description);
    validateTextLength(description, MAX_LENGTHS.ROOM_DESCRIPTION, "Description");

    if (args.genre !== undefined) {
      if (!(ROOM_GENRES as readonly string[]).includes(args.genre)) {
        throw new Error("INVALID_GENRE: Invalid genre");
      }
    }

    const maxPerformers = args.maxPerformers ?? 5;
    if (maxPerformers < 2 || maxPerformers > 7) {
      throw new Error("INVALID_MAX_PERFORMERS: Max performers must be between 2 and 7");
    }

    const lockResult = await acquireUniqueLock(
      ctx,
      "room_handle",
      normalizedHandle,
      profile._id
    );
    if (!lockResult.acquired) {
      throw new Error("HANDLE_TAKEN: This handle is already in use");
    }

    const roomId = await ctx.db.insert("rooms", {
      hostId: profile._id,
      handle: normalizedHandle,
      name,
      description,
      genre: args.genre,
      maxPerformers,
      isPrivate: args.isPrivate ?? false,
      isActive: true,
      streamUrl: MOCK_STREAM_URL,
      status: "idle",
      communityId: args.communityId,
      lastActiveAt: Date.now(),
    });

    return roomId;
  },
});

/** Update room settings (host only). Handle is immutable. */
export const update = mutation({
  args: {
    roomId: v.id("rooms"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    genre: v.optional(v.string()),
    maxPerformers: v.optional(v.number()),
    isPrivate: v.optional(v.boolean()),
    communityId: v.optional(v.id("communities")),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "roomUpdate", profile._id);

    const room = await ctx.db.get(args.roomId);
    if (!room) throw new Error("Room not found");
    if (room.hostId !== profile._id) {
      throw new Error("UNAUTHORIZED: Only the host can edit this room");
    }

    const patch: Partial<Doc<"rooms">> = {};

    if (args.name !== undefined) {
      const name = sanitizeText(args.name) ?? "";
      if (name.length < MIN_LENGTHS.ROOM_NAME) {
        throw new Error(
          `ROOM_NAME_TOO_SHORT: Name must be at least ${MIN_LENGTHS.ROOM_NAME} characters`
        );
      }
      validateTextLength(name, MAX_LENGTHS.ROOM_NAME, "Room name");
      patch.name = name;
    }

    if (args.description !== undefined) {
      const description = sanitizeText(args.description);
      validateTextLength(description, MAX_LENGTHS.ROOM_DESCRIPTION, "Description");
      patch.description = description;
    }

    if (args.genre !== undefined) {
      if (!(ROOM_GENRES as readonly string[]).includes(args.genre)) {
        throw new Error("INVALID_GENRE: Invalid genre");
      }
      patch.genre = args.genre;
    }

    if (args.maxPerformers !== undefined) {
      if (args.maxPerformers < 2 || args.maxPerformers > 7) {
        throw new Error(
          "INVALID_MAX_PERFORMERS: Max performers must be between 2 and 7"
        );
      }
      patch.maxPerformers = args.maxPerformers;
    }

    if (args.isPrivate !== undefined) patch.isPrivate = args.isPrivate;
    if (args.communityId !== undefined) patch.communityId = args.communityId;

    await ctx.db.patch(args.roomId, patch);

    const updated = await ctx.db.get(args.roomId);
    if (!updated) throw new Error("Room not found after update");
    return await formatRoom(ctx, updated);
  },
});

/** Activate a room (host only) */
export const activate = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "roomToggle", profile._id);

    const room = await ctx.db.get(args.roomId);
    if (!room) throw new Error("Room not found");
    if (room.hostId !== profile._id) {
      throw new Error("UNAUTHORIZED: Only the host can activate this room");
    }

    await ctx.db.patch(args.roomId, { isActive: true, lastActiveAt: Date.now() });
    return { success: true };
  },
});

/** Deactivate a room (host only). Presence expires naturally. */
export const deactivate = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "roomToggle", profile._id);

    const room = await ctx.db.get(args.roomId);
    if (!room) throw new Error("Room not found");
    if (room.hostId !== profile._id) {
      throw new Error("UNAUTHORIZED: Only the host can deactivate this room");
    }

    await ctx.db.patch(args.roomId, { isActive: false });
    return { success: true };
  },
});

/** Delete a room entirely (host only) */
export const deleteRoom = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "roomDelete", profile._id);

    const room = await ctx.db.get(args.roomId);
    if (!room) throw new Error("Room not found");
    if (room.hostId !== profile._id) {
      throw new Error("UNAUTHORIZED: Only the host can delete this room");
    }

    // Delete room messages (capped per mutation to avoid timeout)
    const messages = await ctx.db
      .query("room_messages")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .take(500);
    for (const message of messages) {
      await ctx.db.delete(message._id);
    }

    await releaseUniqueLock(ctx, "room_handle", room.handle);
    await ctx.db.delete(args.roomId);
    return { success: true };
  },
});

// ============================================
// Server-facing mutations (for jam server)
// ============================================

/** Set room stream URL (host only) */
export const setStreamUrl = mutation({
  args: { roomId: v.id("rooms"), streamUrl: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "roomServerUpdate", profile._id);
    validateUrl(args.streamUrl);
    const room = await ctx.db.get(args.roomId);
    if (!room) throw new Error("Room not found");
    if (room.hostId !== profile._id) throw new Error("NOT_HOST");
    await ctx.db.patch(args.roomId, { streamUrl: args.streamUrl });
    return { success: true };
  },
});

/** Update room status (host only) — "idle" or "live" */
export const updateRoomStatus = mutation({
  args: { roomId: v.id("rooms"), status: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "roomServerUpdate", profile._id);
    const room = await ctx.db.get(args.roomId);
    if (!room) throw new Error("Room not found");
    if (room.hostId !== profile._id) throw new Error("NOT_HOST");
    if (args.status !== "idle" && args.status !== "live") {
      throw new Error("INVALID_STATUS: Must be 'idle' or 'live'");
    }
    await ctx.db.patch(args.roomId, {
      status: args.status as "idle" | "live",
    });
    return { success: true };
  },
});
