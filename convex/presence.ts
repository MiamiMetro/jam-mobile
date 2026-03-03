import { Presence } from "@convex-dev/presence";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation } from "./_generated/server";
import { requireAuth, areFriends } from "./helpers";
import { checkRateLimit } from "./rateLimiter";

export const GLOBAL_PRESENCE_ROOM_ID = "global:online";
export const DEFAULT_PRESENCE_HEARTBEAT_INTERVAL_MS = 20_000;

export const presenceStatusValidator = v.union(
  v.literal("online"),
  v.literal("away"),
  v.literal("busy")
);

const MIN_HEARTBEAT_INTERVAL_MS = 5_000;
const MAX_HEARTBEAT_INTERVAL_MS = 120_000;

const presence = new Presence(components.presence);

function clampHeartbeatInterval(interval: number | undefined) {
  if (interval === undefined) {
    return DEFAULT_PRESENCE_HEARTBEAT_INTERVAL_MS;
  }
  return Math.max(
    MIN_HEARTBEAT_INTERVAL_MS,
    Math.min(MAX_HEARTBEAT_INTERVAL_MS, Math.floor(interval))
  );
}

export const heartbeat = mutation({
  args: {
    sessionId: v.string(),
    interval: v.optional(v.number()),
    status: v.optional(presenceStatusValidator),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    const interval = clampHeartbeatInterval(args.interval);
    const result = await presence.heartbeat(
      ctx,
      GLOBAL_PRESENCE_ROOM_ID,
      String(profile._id),
      args.sessionId,
      interval
    );
    await presence.updateRoomUser(
      ctx,
      GLOBAL_PRESENCE_ROOM_ID,
      String(profile._id),
      {
        status: args.status ?? "online",
      }
    );
    return result;
  },
});

export const disconnect = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    return await presence.disconnect(ctx, args.sessionToken);
  },
});

/**
 * Heartbeat into a jam room presence room.
 * Validates room access (active, private/friends-only).
 */
export const roomHeartbeat = mutation({
  args: {
    roomId: v.id("rooms"),
    sessionId: v.string(),
    interval: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    const interval = clampHeartbeatInterval(args.interval);

    const room = await ctx.db.get(args.roomId);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    if (!room.isActive) throw new Error("ROOM_INACTIVE");

    // Private room: friends only
    if (room.isPrivate && room.hostId !== profile._id) {
      const friends = await areFriends(ctx, profile._id, room.hostId);
      if (!friends) {
        throw new Error("PRIVATE_ROOM: This room is friends only");
      }
    }

    const roomPresenceId = `room:${args.roomId}`;
    return await presence.heartbeat(
      ctx,
      roomPresenceId,
      String(profile._id),
      args.sessionId,
      interval
    );
  },
});

/**
 * Guest heartbeat for jam rooms — no auth required, public rooms only.
 * Uses "guest:{sessionId}" as the user identifier.
 */
const MAX_SESSION_ID_LENGTH = 100;

export const guestRoomHeartbeat = mutation({
  args: {
    roomId: v.id("rooms"),
    sessionId: v.string(),
    interval: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.sessionId.length > MAX_SESSION_ID_LENGTH) {
      throw new Error("INVALID_SESSION_ID: Session ID too long");
    }
    await checkRateLimit(ctx, "guestRoomHeartbeat", args.sessionId);
    const interval = clampHeartbeatInterval(args.interval);

    const room = await ctx.db.get(args.roomId);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    if (!room.isActive) throw new Error("ROOM_INACTIVE");
    if (room.isPrivate) throw new Error("PRIVATE_ROOM: Sign in to join");

    const guestUserId = `guest:${args.sessionId}`;
    const roomPresenceId = `room:${args.roomId}`;
    return await presence.heartbeat(
      ctx,
      roomPresenceId,
      guestUserId,
      args.sessionId,
      interval
    );
  },
});

export const setMyStatus = mutation({
  args: {
    status: presenceStatusValidator,
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "presenceStatus", String(profile._id));
    await presence.updateRoomUser(
      ctx,
      GLOBAL_PRESENCE_ROOM_ID,
      String(profile._id),
      {
        status: args.status,
      }
    );
    return { status: args.status };
  },
});

