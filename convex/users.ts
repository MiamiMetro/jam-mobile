import { query } from "./_generated/server";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { Presence } from "@convex-dev/presence";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import {
  formatPublicProfileIdentity,
  getCurrentProfile,
  isDiscoverableAccountState,
} from "./helpers";
import { GLOBAL_PRESENCE_ROOM_ID } from "./presence";

const presence = new Presence(components.presence);
type PresenceStatus = "online" | "away" | "busy";

function getPresenceStatusFromData(data: unknown): PresenceStatus {
  if (
    typeof data === "object" &&
    data !== null &&
    "status" in data &&
    (((data as { status?: unknown }).status === "away") ||
      (data as { status?: unknown }).status === "busy")
  ) {
    return (data as { status: PresenceStatus }).status;
  }
  return "online";
}

/**
 * Search users using native Convex pagination.
 * This is the preferred endpoint for Convex-first frontend pagination.
 * Uses index-backed username search and avoids fallback table scans.
 */
export const searchPaginated = query({
  args: {
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const currentProfile = await getCurrentProfile(ctx);
    const trimmedSearch = args.search?.trim();

    const result = trimmedSearch
      ? await ctx.db
          .query("profiles")
          .withSearchIndex("search_profiles", (q) =>
            q.search("username", trimmedSearch).eq("accountState", "active")
          )
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("profiles")
          .withIndex("by_account_state", (q) => q.eq("accountState", "active"))
          .order("desc")
          .paginate(args.paginationOpts);

    const page = result.page
      .filter(
        (user) =>
          (!currentProfile || user._id !== currentProfile._id) &&
          isDiscoverableAccountState(user.accountState)
      )
      .map((user) => ({
        ...formatPublicProfileIdentity(user),
        status: "offline",
        statusMessage: "",
      }));

    return {
      ...result,
      page,
    };
  },
});

/**
 * Get online users
 * Presence-backed list of currently online users.
 */
export const getOnline = query({
  args: {
    limit: v.optional(v.number()),
    roomToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentProfile = await getCurrentProfile(ctx);
    const onlineUsersWithStatus = args.roomToken
      ? (await presence.list(ctx, args.roomToken, args.limit)).filter(
          (presenceUser) => presenceUser.online
        )
      : (await presence.listRoom(
          ctx,
          GLOBAL_PRESENCE_ROOM_ID,
          true,
          args.limit
        )).map((presenceUser) => ({
          ...presenceUser,
          data: undefined as unknown,
        }));
    const onlineUserIds = onlineUsersWithStatus.map(
      ({ userId }) => userId as Id<"profiles">
    );
    const presenceStatusById = new Map<string, PresenceStatus>(
      onlineUsersWithStatus.map((presenceUser) => [
        String(presenceUser.userId),
        getPresenceStatusFromData(presenceUser.data),
      ])
    );

    if (onlineUserIds.length === 0) {
      return [];
    }

    const profiles = await Promise.all(
      onlineUserIds.map((profileId) => ctx.db.get(profileId))
    );

    return profiles
      .filter(
        (
          profile
        ): profile is NonNullable<(typeof profiles)[number]> => profile !== null
      )
      .filter(
        (profile) =>
          (!currentProfile || profile._id !== currentProfile._id) &&
          isDiscoverableAccountState(profile.accountState)
      )
      .map((profile) => ({
        ...formatPublicProfileIdentity(profile),
        status: presenceStatusById.get(String(profile._id)) ?? "online",
        statusMessage: "",
      }));
  },
});

/**
 * Lightweight online status endpoint for snapshot checks in global UI.
 */
export const getOnlineIds = query({
  args: {
    userIds: v.optional(v.array(v.id("profiles"))),
  },
  handler: async (ctx, args) => {
    if (args.userIds) {
      const uniqueUserIds = new Map<string, Id<"profiles">>();
      for (const userId of args.userIds) {
        uniqueUserIds.set(String(userId), userId);
      }

      const onlineUserIds: Id<"profiles">[] = [];
      for (const [userIdString, userId] of uniqueUserIds.entries()) {
        const rooms = await presence.listUser(ctx, userIdString, true, 1);
        if (
          rooms.some(
            (room) => room.roomId === GLOBAL_PRESENCE_ROOM_ID && room.online
          )
        ) {
          onlineUserIds.push(userId);
        }
      }
      return onlineUserIds;
    }

    const onlineUsers = await presence.listRoom(
      ctx,
      GLOBAL_PRESENCE_ROOM_ID,
      true
    );
    return onlineUsers.map(({ userId }) => userId as Id<"profiles">);
  },
});

