import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  requireAuth,
  getCurrentProfile,
  formatPublicProfileIdentity,
  validateTextLength,
  sanitizeText,
  areFriends,
  MAX_LENGTHS,
} from "./helpers";
import { checkRateLimit } from "./rateLimiter";
import { Presence } from "@convex-dev/presence";
import { components } from "./_generated/api";

const presence = new Presence(components.presence);

/** Get latest 30 messages for a room — only if room is active (and accessible) */
export const getLatest = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room || !room.isActive) return [];

    // Private room: only friends of host (or host) can see messages
    if (room.isPrivate) {
      const profile = await getCurrentProfile(ctx);
      if (!profile) return [];
      if (profile._id !== room.hostId) {
        const friends = await areFriends(ctx, profile._id, room.hostId);
        if (!friends) return [];
      }
    }

    const messages = await ctx.db
      .query("room_messages")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .order("desc")
      .take(30);

    // Reverse to chronological order (oldest first for display)
    const chronological = messages.reverse();

    const formatted = await Promise.all(
      chronological.map(async (msg) => {
        const sender = await ctx.db.get(msg.senderId);
        return {
          id: msg._id,
          room_id: msg.roomId,
          sender_id: msg.senderId,
          sender: sender ? formatPublicProfileIdentity(sender) : null,
          text: msg.text,
          created_at: new Date(msg._creationTime).toISOString(),
          _creationTime: msg._creationTime,
        };
      })
    );

    return formatted;
  },
});

/** Send a message in a room — must have presence in the room */
export const send = mutation({
  args: {
    roomId: v.id("rooms"),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "roomMessageSend", profile._id);

    const room = await ctx.db.get(args.roomId);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    if (!room.isActive) throw new Error("ROOM_NOT_ACTIVE");

    // Private room: only friends of host can chat
    if (room.isPrivate && room.hostId !== profile._id) {
      const friends = await areFriends(ctx, profile._id, room.hostId);
      if (!friends) {
        throw new Error("PRIVATE_ROOM: This room is friends only");
      }
    }

    // Must have presence in the room (heartbeating)
    const roomPresenceId = `room:${args.roomId}`;
    const onlineUsers = await presence.listRoom(ctx, roomPresenceId, true);
    const isInRoom =
      room.hostId === profile._id ||
      onlineUsers.some((u) => u.userId === String(profile._id));
    if (!isInRoom) {
      throw new Error("NOT_IN_ROOM: You must be in the room to send messages");
    }

    const text = sanitizeText(args.text);
    if (!text) throw new Error("EMPTY_MESSAGE");
    validateTextLength(text, MAX_LENGTHS.ROOM_MESSAGE, "Room message");

    const messageId = await ctx.db.insert("room_messages", {
      roomId: args.roomId,
      senderId: profile._id,
      text,
    });

    return messageId;
  },
});
