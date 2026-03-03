import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { extractManagedMediaObjectKeyFromUrl } from "./mediaService";

type BackfillTable =
  | "profiles"
  | "posts"
  | "comments"
  | "messages"
  | "conversations";

type BackfillResult = {
  processed: number;
  updated: number;
  continueCursor: string;
  isDone: boolean;
  table: BackfillTable;
};

function clampLimit(value: number | undefined): number {
  if (value === undefined) return 200;
  return Math.min(500, Math.max(1, Math.floor(value)));
}

export const backfillObjectKeys = mutation({
  args: {
    table: v.union(
      v.literal("profiles"),
      v.literal("posts"),
      v.literal("comments"),
      v.literal("messages"),
      v.literal("conversations")
    ),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    clearManagedUrls: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<BackfillResult> => {
    const numItems = clampLimit(args.limit);
    const dryRun = args.dryRun ?? false;
    const clearManagedUrls = args.clearManagedUrls ?? false;

    if (args.table === "profiles") {
      const page = await ctx.db
        .query("profiles")
        .paginate({ cursor: args.cursor ?? null, numItems });
      let updated = 0;

      for (const doc of page.page) {
        const patch: {
          avatarObjectKey?: string;
          bannerObjectKey?: string;
          avatarUrl?: string;
          bannerUrl?: string;
        } = {};

        if (!doc.avatarObjectKey && doc.avatarUrl) {
          const key = extractManagedMediaObjectKeyFromUrl(doc.avatarUrl);
          if (key) patch.avatarObjectKey = key;
        }
        if (!doc.bannerObjectKey && doc.bannerUrl) {
          const key = extractManagedMediaObjectKeyFromUrl(doc.bannerUrl);
          if (key) patch.bannerObjectKey = key;
        }

        if (clearManagedUrls && doc.avatarUrl) {
          const key = extractManagedMediaObjectKeyFromUrl(doc.avatarUrl);
          if (key) patch.avatarUrl = undefined;
        }
        if (clearManagedUrls && doc.bannerUrl) {
          const key = extractManagedMediaObjectKeyFromUrl(doc.bannerUrl);
          if (key) patch.bannerUrl = undefined;
        }

        if (Object.keys(patch).length > 0) {
          updated += 1;
          if (!dryRun) await ctx.db.patch(doc._id, patch);
        }
      }

      return {
        table: args.table,
        processed: page.page.length,
        updated,
        continueCursor: page.continueCursor,
        isDone: page.isDone,
      };
    }

    if (args.table === "posts") {
      const page = await ctx.db
        .query("posts")
        .paginate({ cursor: args.cursor ?? null, numItems });
      let updated = 0;

      for (const doc of page.page) {
        const patch: { audioObjectKey?: string; audioUrl?: string } = {};
        if (!doc.audioObjectKey && doc.audioUrl) {
          const key = extractManagedMediaObjectKeyFromUrl(doc.audioUrl);
          if (key) patch.audioObjectKey = key;
        }
        if (clearManagedUrls && doc.audioUrl) {
          const key = extractManagedMediaObjectKeyFromUrl(doc.audioUrl);
          if (key) patch.audioUrl = undefined;
        }
        if (Object.keys(patch).length > 0) {
          updated += 1;
          if (!dryRun) await ctx.db.patch(doc._id, patch);
        }
      }

      return {
        table: args.table,
        processed: page.page.length,
        updated,
        continueCursor: page.continueCursor,
        isDone: page.isDone,
      };
    }

    if (args.table === "comments") {
      const page = await ctx.db
        .query("comments")
        .paginate({ cursor: args.cursor ?? null, numItems });
      let updated = 0;

      for (const doc of page.page) {
        const patch: { audioObjectKey?: string; audioUrl?: string } = {};
        if (!doc.audioObjectKey && doc.audioUrl) {
          const key = extractManagedMediaObjectKeyFromUrl(doc.audioUrl);
          if (key) patch.audioObjectKey = key;
        }
        if (clearManagedUrls && doc.audioUrl) {
          const key = extractManagedMediaObjectKeyFromUrl(doc.audioUrl);
          if (key) patch.audioUrl = undefined;
        }
        if (Object.keys(patch).length > 0) {
          updated += 1;
          if (!dryRun) await ctx.db.patch(doc._id, patch);
        }
      }

      return {
        table: args.table,
        processed: page.page.length,
        updated,
        continueCursor: page.continueCursor,
        isDone: page.isDone,
      };
    }

    if (args.table === "messages") {
      const page = await ctx.db
        .query("messages")
        .paginate({ cursor: args.cursor ?? null, numItems });
      let updated = 0;

      for (const doc of page.page) {
        const patch: { audioObjectKey?: string; audioUrl?: string } = {};
        if (!doc.audioObjectKey && doc.audioUrl) {
          const key = extractManagedMediaObjectKeyFromUrl(doc.audioUrl);
          if (key) patch.audioObjectKey = key;
        }
        if (clearManagedUrls && doc.audioUrl) {
          const key = extractManagedMediaObjectKeyFromUrl(doc.audioUrl);
          if (key) patch.audioUrl = undefined;
        }
        if (Object.keys(patch).length > 0) {
          updated += 1;
          if (!dryRun) await ctx.db.patch(doc._id, patch);
        }
      }

      return {
        table: args.table,
        processed: page.page.length,
        updated,
        continueCursor: page.continueCursor,
        isDone: page.isDone,
      };
    }

    const page = await ctx.db
      .query("conversations")
      .paginate({ cursor: args.cursor ?? null, numItems });
    let updated = 0;

    for (const doc of page.page) {
      const patch: { lastMessageAudioObjectKey?: string; lastMessageAudioUrl?: string } = {};
      if (!doc.lastMessageAudioObjectKey && doc.lastMessageAudioUrl) {
        const key = extractManagedMediaObjectKeyFromUrl(doc.lastMessageAudioUrl);
        if (key) patch.lastMessageAudioObjectKey = key;
      }
      if (clearManagedUrls && doc.lastMessageAudioUrl) {
        const key = extractManagedMediaObjectKeyFromUrl(doc.lastMessageAudioUrl);
        if (key) patch.lastMessageAudioUrl = undefined;
      }
      if (Object.keys(patch).length > 0) {
        updated += 1;
        if (!dryRun) await ctx.db.patch(doc._id, patch);
      }
    }

    return {
      table: args.table,
      processed: page.page.length,
      updated,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});
