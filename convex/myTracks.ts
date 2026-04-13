import { query, mutation } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import {
  requireAuth,
  getCurrentProfile,
  formatPublicProfileIdentity,
  validateTextLength,
  sanitizeText,
} from "./helpers";
import { extractManagedMediaObjectKeyFromUrl } from "./mediaService";
import { consumeReadyUploadSessionByPublicUrl } from "./uploadSessions";
import { checkRateLimit } from "./rateLimiter";

// ============================================
// Constants
// ============================================

const MAX_TRACKS_PER_USER = 30;
const MAX_TRACK_TITLE = 100;

// ============================================
// Format Helper
// ============================================

async function formatTrack(
  ctx: QueryCtx | MutationCtx,
  track: Doc<"my_tracks">
) {
  const ownerProfile = await ctx.db.get(track.ownerId);

  return {
    id: track._id,
    owner: ownerProfile ? formatPublicProfileIdentity(ownerProfile) : null,
    title: track.title,
    audio_url: track.audioUrl ?? "",
    duration: track.duration,
    file_size: track.fileSize,
    content_type: track.contentType,
    created_at: new Date(track.createdAt).toISOString(),
  };
}

// ============================================
// Queries
// ============================================

/**
 * Get current user's tracks (paginated, newest first)
 */
export const getMyTracks = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const currentProfile = await getCurrentProfile(ctx);
    if (!currentProfile) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const result = await ctx.db
      .query("my_tracks")
      .withIndex("by_owner", (q) => q.eq("ownerId", currentProfile._id))
      .order("desc")
      .paginate(args.paginationOpts);

    const page = await Promise.all(
      result.page.map((track) => formatTrack(ctx, track))
    );

    return { ...result, page };
  },
});

/**
 * Get current user's track count
 */
export const getMyTrackCount = query({
  args: {},
  handler: async (ctx) => {
    const currentProfile = await getCurrentProfile(ctx);
    if (!currentProfile) return 0;

    const tracks = await ctx.db
      .query("my_tracks")
      .withIndex("by_owner", (q) => q.eq("ownerId", currentProfile._id))
      .collect();

    return tracks.length;
  },
});

// ============================================
// Mutations
// ============================================

/**
 * Add a new track to the user's music library
 * After uploading audio via R2, call this with the public URL
 */
export const addTrack = mutation({
  args: {
    title: v.string(),
    audioUrl: v.string(),
    duration: v.number(),
    fileSize: v.number(),
    contentType: v.string(),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "myTrackUpload", profile._id);

    // Validate title
    const title = sanitizeText(args.title) ?? "";
    if (title.length < 1) {
      throw new Error("TITLE_REQUIRED: Track title is required");
    }
    validateTextLength(title, MAX_TRACK_TITLE, "Title");

    // Validate audio URL
    const audioUrl = args.audioUrl.trim();
    if (!audioUrl) {
      throw new Error("AUDIO_URL_REQUIRED: Audio URL is required");
    }

    // Validate content type (audio only)
    const normalizedType = args.contentType.toLowerCase();
    if (!normalizedType.startsWith("audio/")) {
      throw new Error("INVALID_FILE_TYPE: Only audio files are allowed");
    }

    // Validate duration
    if (args.duration < 0 || args.duration > 36000) {
      throw new Error("INVALID_DURATION: Duration must be between 0 and 36000 seconds");
    }

    // Check track count limit
    const existingTracks = await ctx.db
      .query("my_tracks")
      .withIndex("by_owner", (q) => q.eq("ownerId", profile._id))
      .collect();

    if (existingTracks.length >= MAX_TRACKS_PER_USER) {
      throw new Error(
        `TRACK_LIMIT_REACHED: You can have at most ${MAX_TRACKS_PER_USER} tracks`
      );
    }

    // Consume audio upload session
    const audioObjectKey = extractManagedMediaObjectKeyFromUrl(audioUrl);
    let finalAudioObjectKey: string | undefined;

    if (audioObjectKey) {
      const session = await consumeReadyUploadSessionByPublicUrl(ctx, {
        ownerProfileId: profile._id,
        publicUrl: audioUrl,
        kind: "audio",
      });
      finalAudioObjectKey = session.objectKey;
    }

    const trackId = await ctx.db.insert("my_tracks", {
      ownerId: profile._id,
      title,
      audioUrl: audioObjectKey ? undefined : audioUrl,
      audioObjectKey: finalAudioObjectKey,
      duration: args.duration,
      fileSize: args.fileSize,
      contentType: args.contentType,
      createdAt: Date.now(),
    });

    const track = await ctx.db.get(trackId);
    if (!track) throw new Error("Failed to create track");

    return await formatTrack(ctx, track);
  },
});

/**
 * Delete a track from the user's library
 */
export const deleteTrack = mutation({
  args: {
    trackId: v.id("my_tracks"),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "myTrackDelete", profile._id);

    const track = await ctx.db.get(args.trackId);
    if (!track) {
      throw new Error("TRACK_NOT_FOUND: Track not found");
    }
    if (track.ownerId !== profile._id) {
      throw new Error("UNAUTHORIZED: Only the owner can delete this track");
    }

    await ctx.db.delete(args.trackId);
    return { success: true };
  },
});
