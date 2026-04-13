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
  MAX_LENGTHS,
} from "./helpers";
import { checkRateLimit } from "./rateLimiter";

// ============================================
// Band Constants
// ============================================

export const BAND_SEEKING_ROLES = [
  "Vocalist",
  "Guitarist",
  "Bassist",
  "Drummer",
  "Keyboardist",
  "Producer",
  "Other",
] as const;

export type BandSeekingRole = (typeof BAND_SEEKING_ROLES)[number];

const MAX_ACTIVE_LISTINGS = 3;

function normalizeRegion(region: string) {
  return region.trim().toLowerCase();
}

// ============================================
// Internal Format Helper
// ============================================

async function formatListing(
  ctx: QueryCtx | MutationCtx,
  listing: Doc<"band_listings">
) {
  const ownerProfile = await ctx.db.get(listing.ownerId);

  return {
    id: listing._id,
    owner: ownerProfile ? formatPublicProfileIdentity(ownerProfile) : null,
    band_name: listing.bandName,
    current_members: listing.currentMembers,
    max_members: listing.maxMembers,
    seeking_role: listing.seekingRole,
    region: listing.region,
    description: listing.description ?? "",
    genre: listing.genre ?? "",
    status: listing.status,
    applications_count: listing.applicationsCount,
    created_at: new Date(listing.createdAt).toISOString(),
  };
}

async function formatApplication(
  ctx: QueryCtx | MutationCtx,
  application: Doc<"band_applications">
) {
  const applicantProfile = await ctx.db.get(application.applicantId);

  return {
    id: application._id,
    listing_id: application.listingId,
    applicant: applicantProfile
      ? formatPublicProfileIdentity(applicantProfile)
      : null,
    instrument: application.instrument,
    experience: application.experience,
    message: application.message ?? "",
    created_at: new Date(application.createdAt).toISOString(),
  };
}

// ============================================
// Queries
// ============================================

/**
 * List band listings with optional filters (paginated)
 */
export const listPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    seekingRole: v.optional(v.string()),
    region: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const hasSearch = args.search && args.search.trim().length > 0;
    const normalizedRegion = args.region?.trim()
      ? normalizeRegion(args.region)
      : undefined;

    if (hasSearch) {
      const result = await ctx.db
        .query("band_listings")
        .withSearchIndex("search_band_listings", (q) => {
          let query = q.search("bandName", args.search!.trim());
          query = query.eq("status", "open");
          if (args.seekingRole) {
            query = query.eq("seekingRole", args.seekingRole);
          }
          if (normalizedRegion) {
            query = query.eq("regionNormalized", normalizedRegion);
          }
          return query;
        })
        .paginate(args.paginationOpts);
      const page = await Promise.all(
        result.page.map((listing) => formatListing(ctx, listing))
      );
      return { ...result, page };
    }

    let result;
    if (args.seekingRole && normalizedRegion) {
      result = await ctx.db
        .query("band_listings")
        .withIndex("by_status_role_and_region", (q) =>
          q
            .eq("status", "open")
            .eq("seekingRole", args.seekingRole!)
            .eq("regionNormalized", normalizedRegion)
        )
        .order("desc")
        .paginate(args.paginationOpts);
    } else if (args.seekingRole) {
      result = await ctx.db
        .query("band_listings")
        .withIndex("by_status_and_role", (q) =>
          q.eq("status", "open").eq("seekingRole", args.seekingRole!)
        )
        .order("desc")
        .paginate(args.paginationOpts);
    } else if (normalizedRegion) {
      result = await ctx.db
        .query("band_listings")
        .withIndex("by_status_and_region", (q) =>
          q.eq("status", "open").eq("regionNormalized", normalizedRegion)
        )
        .order("desc")
        .paginate(args.paginationOpts);
    } else {
      result = await ctx.db
        .query("band_listings")
        .withIndex("by_status", (q) => q.eq("status", "open"))
        .order("desc")
        .paginate(args.paginationOpts);
    }

    const page = await Promise.all(
      result.page.map((listing) => formatListing(ctx, listing))
    );

    return { ...result, page };
  },
});

/**
 * Get current user's listings (all statuses, paginated)
 */
export const getMyListingsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const currentProfile = await getCurrentProfile(ctx);
    if (!currentProfile) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const result = await ctx.db
      .query("band_listings")
      .withIndex("by_owner", (q) => q.eq("ownerId", currentProfile._id))
      .order("desc")
      .paginate(args.paginationOpts);

    const page = await Promise.all(
      result.page.map((listing) => formatListing(ctx, listing))
    );

    return { ...result, page };
  },
});

/**
 * Get active listing count for current user
 */
export const getActiveListingCount = query({
  args: {},
  handler: async (ctx) => {
    const currentProfile = await getCurrentProfile(ctx);
    if (!currentProfile) return 0;

    const listings = await ctx.db
      .query("band_listings")
      .withIndex("by_owner_and_status", (q) =>
        q.eq("ownerId", currentProfile._id).eq("status", "open")
      )
      .collect();

    return listings.length;
  },
});

/**
 * Get band listings for a specific user (public, open listings only, paginated)
 */
export const getByUserPaginated = query({
  args: {
    userId: v.id("profiles"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("band_listings")
      .withIndex("by_owner_and_status", (q) =>
        q.eq("ownerId", args.userId).eq("status", "open")
      )
      .order("desc")
      .paginate(args.paginationOpts);

    const page = await Promise.all(
      result.page.map((listing) => formatListing(ctx, listing))
    );

    return { ...result, page };
  },
});

/**
 * Get applications for a specific listing (owner only)
 */
export const getApplications = query({
  args: {
    listingId: v.id("band_listings"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const currentProfile = await getCurrentProfile(ctx);
    if (!currentProfile) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    // Verify ownership
    const listing = await ctx.db.get(args.listingId);
    if (!listing || listing.ownerId !== currentProfile._id) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const result = await ctx.db
      .query("band_applications")
      .withIndex("by_listing", (q) => q.eq("listingId", args.listingId))
      .order("desc")
      .paginate(args.paginationOpts);

    const page = await Promise.all(
      result.page.map((app) => formatApplication(ctx, app))
    );

    return { ...result, page };
  },
});

/**
 * Get applications made by the current user (paginated)
 */
export const getMyApplicationsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const currentProfile = await getCurrentProfile(ctx);
    if (!currentProfile) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const result = await ctx.db
      .query("band_applications")
      .withIndex("by_applicant", (q) =>
        q.eq("applicantId", currentProfile._id)
      )
      .order("desc")
      .paginate(args.paginationOpts);

    const page = await Promise.all(
      result.page.map((app) => formatApplication(ctx, app))
    );

    return { ...result, page };
  },
});

// ============================================
// Mutations
// ============================================

/**
 * Create a new band listing
 * Users can have at most 3 active (open) listings
 */
export const createListing = mutation({
  args: {
    bandName: v.string(),
    currentMembers: v.number(),
    maxMembers: v.number(),
    seekingRole: v.string(),
    region: v.string(),
    description: v.optional(v.string()),
    genre: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "createBandListing", profile._id);

    // Validate band name
    const bandName = sanitizeText(args.bandName) ?? "";
    if (bandName.length < 2) {
      throw new Error("BAND_NAME_TOO_SHORT: Band name must be at least 2 characters");
    }
    validateTextLength(bandName, MAX_LENGTHS.BAND_NAME, "Band name");

    // Validate members
    if (args.currentMembers < 1 || args.currentMembers > 50) {
      throw new Error("INVALID_CURRENT_MEMBERS: Current members must be between 1 and 50");
    }
    if (args.maxMembers < 2 || args.maxMembers > 50) {
      throw new Error("INVALID_MAX_MEMBERS: Max members must be between 2 and 50");
    }
    if (args.currentMembers > args.maxMembers) {
      throw new Error("INVALID_MEMBERS: Current members cannot exceed max members");
    }

    // Validate seeking role
    if (!(BAND_SEEKING_ROLES as readonly string[]).includes(args.seekingRole)) {
      throw new Error("INVALID_ROLE: Invalid seeking role");
    }

    // Validate region
    const region = sanitizeText(args.region) ?? "";
    if (region.length < 2) {
      throw new Error("REGION_TOO_SHORT: Region must be at least 2 characters");
    }
    validateTextLength(region, MAX_LENGTHS.BAND_REGION, "Region");

    // Validate description
    const description = sanitizeText(args.description);
    validateTextLength(description, MAX_LENGTHS.BAND_DESCRIPTION, "Description");

    // Validate genre
    const genre = sanitizeText(args.genre);

    // Check active listing count
    const activeListings = await ctx.db
      .query("band_listings")
      .withIndex("by_owner", (q) => q.eq("ownerId", profile._id))
      .collect();
    const activeCount = activeListings.filter((l) => l.status === "open").length;
    if (activeCount >= MAX_ACTIVE_LISTINGS) {
      throw new Error(
        `LISTING_LIMIT_REACHED: You can have at most ${MAX_ACTIVE_LISTINGS} active listings`
      );
    }

    const listingId = await ctx.db.insert("band_listings", {
      ownerId: profile._id,
      bandName,
      currentMembers: args.currentMembers,
      maxMembers: args.maxMembers,
      seekingRole: args.seekingRole,
      region,
      regionNormalized: normalizeRegion(region),
      description,
      genre,
      status: "open",
      applicationsCount: 0,
      createdAt: Date.now(),
    });

    const listing = await ctx.db.get(listingId);
    if (!listing) throw new Error("Failed to create listing");

    return await formatListing(ctx, listing);
  },
});

/**
 * Close a listing (owner only)
 */
export const closeListing = mutation({
  args: { listingId: v.id("band_listings") },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "bandListingAction", profile._id);

    const listing = await ctx.db.get(args.listingId);
    if (!listing) throw new Error("Listing not found");
    if (listing.ownerId !== profile._id) {
      throw new Error("UNAUTHORIZED: Only the owner can close this listing");
    }
    if (listing.status === "closed") {
      throw new Error("ALREADY_CLOSED: This listing is already closed");
    }

    await ctx.db.patch(args.listingId, { status: "closed" });
    return { success: true };
  },
});

/**
 * Delete a listing (owner only)
 * Also deletes all associated applications
 */
export const deleteListing = mutation({
  args: { listingId: v.id("band_listings") },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "bandListingAction", profile._id);

    const listing = await ctx.db.get(args.listingId);
    if (!listing) throw new Error("Listing not found");
    if (listing.ownerId !== profile._id) {
      throw new Error("UNAUTHORIZED: Only the owner can delete this listing");
    }

    // Delete all applications for this listing
    const applications = await ctx.db
      .query("band_applications")
      .withIndex("by_listing", (q) => q.eq("listingId", args.listingId))
      .collect();

    for (const app of applications) {
      await ctx.db.delete(app._id);
    }

    await ctx.db.delete(args.listingId);
    return { success: true };
  },
});

/**
 * Apply to a band listing
 * Users cannot apply to their own listings
 * Users cannot apply to the same listing twice
 */
export const apply = mutation({
  args: {
    listingId: v.id("band_listings"),
    instrument: v.string(),
    experience: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "applyToBand", profile._id);

    const listing = await ctx.db.get(args.listingId);
    if (!listing) throw new Error("Listing not found");
    if (listing.status !== "open") {
      throw new Error("LISTING_CLOSED: This listing is no longer accepting applications");
    }
    if (listing.ownerId === profile._id) {
      throw new Error("CANNOT_APPLY_OWN: You cannot apply to your own listing");
    }

    // Check for duplicate application
    const existing = await ctx.db
      .query("band_applications")
      .withIndex("by_listing_and_applicant", (q) =>
        q.eq("listingId", args.listingId).eq("applicantId", profile._id)
      )
      .first();

    if (existing) {
      throw new Error("ALREADY_APPLIED: You have already applied to this listing");
    }

    // Validate instrument
    const instrument = sanitizeText(args.instrument) ?? "";
    if (instrument.length < 2) {
      throw new Error("INSTRUMENT_TOO_SHORT: Instrument must be at least 2 characters");
    }

    // Validate experience
    const experience = sanitizeText(args.experience) ?? "";
    if (experience.length < 10) {
      throw new Error("EXPERIENCE_TOO_SHORT: Experience must be at least 10 characters");
    }
    validateTextLength(experience, MAX_LENGTHS.BAND_EXPERIENCE, "Experience");

    // Validate message
    const message = sanitizeText(args.message);
    validateTextLength(message, MAX_LENGTHS.BAND_APPLICATION_MESSAGE, "Message");

    await ctx.db.insert("band_applications", {
      listingId: args.listingId,
      applicantId: profile._id,
      instrument,
      experience,
      message,
      createdAt: Date.now(),
    });

    // Increment applications count (denormalized)
    await ctx.db.patch(args.listingId, {
      applicationsCount: listing.applicationsCount + 1,
    });

    return { success: true };
  },
});
