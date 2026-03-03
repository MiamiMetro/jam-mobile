import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { extractManagedMediaObjectKeyFromUrl } from "./mediaService";
import { consumeReadyUploadSessionByPublicUrl } from "./uploadSessions";
import {
  assertValidAccountStateTransition,
  DELETED_ACCOUNT_DISPLAY_NAME,
  getCurrentProfile,
  isDiscoverableAccountState,
  requireAuth,
  resolveAccountState,
  formatProfile,
  validateTextLength,
  validateUsername,
  validateUrl,
  sanitizeText,
  normalizeUsername,
  acquireUniqueLock,
  sanitizeProfileTags,
  setUniqueLockOwner,
  releaseUniqueLock,
  MAX_LENGTHS,
} from "./helpers";
import { checkRateLimit } from "./rateLimiter";
import type { MutationCtx } from "./_generated/server";

const PROFILE_CATALOG = {
  instruments: [
    "Guitar",
    "Bass",
    "Drums",
    "Keys",
    "Piano",
    "Synth",
    "Vocals",
    "Violin",
    "Saxophone",
    "DJ",
    "Producer",
  ],
  genres: [
    "Lo-Fi",
    "Jazz",
    "Hip Hop",
    "Rock",
    "Electronic",
    "R&B",
    "Pop",
    "Metal",
    "House",
    "Ambient",
    "Indie",
  ],
} as const;

async function generateDeletedUsername(
  ctx: MutationCtx,
  profileId: string
): Promise<string> {
  const compactId = profileId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

  for (let i = 0; i < 6; i++) {
    const nonce = (Date.now() + i).toString(36).slice(-4);
    const tail = `${compactId}${nonce}`.slice(-10);
    const candidate = `del_${tail}`;

    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", candidate))
      .first();

    if (!existing || existing._id === profileId) {
      return candidate;
    }
  }

  return `del_${Date.now().toString(36).slice(-10)}`.slice(0, 15);
}

/**
 * Get the current user's profile
 * Equivalent to GET /profiles/me and GET /auth/me
 */
export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const profile = await getCurrentProfile(ctx);
    if (!profile) {
      return null;
    }
    return formatProfile(profile);
  },
});

/**
 * Update the current user's profile
 * Equivalent to PATCH /profiles/me
 */
export const updateMe = mutation({
  args: {
    username: v.optional(v.string()),
    display_name: v.optional(v.string()),
    avatar_url: v.optional(v.string()),
    banner_url: v.optional(v.string()),
    bio: v.optional(v.string()),
    instruments: v.optional(v.array(v.string())),
    genres: v.optional(v.array(v.string())),
    dm_privacy: v.optional(v.union(v.literal("friends"), v.literal("everyone"))),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "updateProfile", profile._id);

    if ((profile.accountState ?? "active") !== "active") {
      throw new Error("PROFILE_LOCKED: This account cannot be updated");
    }

    // Sanitize and validate inputs
    const username = normalizeUsername(sanitizeText(args.username));
    const displayName = sanitizeText(args.display_name);
    const avatarUrl = args.avatar_url;
    const avatarObjectKey = extractManagedMediaObjectKeyFromUrl(avatarUrl);
    const bannerUrl = args.banner_url;
    const bannerObjectKey = extractManagedMediaObjectKeyFromUrl(bannerUrl);
    const bio = sanitizeText(args.bio);
    const instruments = sanitizeProfileTags(args.instruments, "Instruments");
    const genres = sanitizeProfileTags(args.genres, "Genres");
    const authIdentityKey = `${profile.authIssuer}:${profile.authSubject}`;

    // Validate username if provided
    if (username !== undefined) {
      validateUsername(username);
    }
    validateTextLength(displayName, MAX_LENGTHS.DISPLAY_NAME, "Display name");
    validateTextLength(bio, MAX_LENGTHS.BIO, "Bio");
    validateUrl(avatarUrl);
    validateUrl(bannerUrl);

    // If username is being changed, check uniqueness against legacy rows too.
    if (username && username !== profile.username) {
      const existing = await ctx.db
        .query("profiles")
        .withIndex("by_username", (q) => q.eq("username", username))
        .first();

      if (existing && existing._id !== profile._id) {
        throw new Error("USERNAME_TAKEN: Username already taken");
      }
    }

    const usernameChanged = username !== undefined && username !== profile.username;
    const previousUsername = normalizeUsername(profile.username) ?? profile.username;
    let acquiredNewUsernameLock = false;
    let newUsernameLockValue: string | null = null;

    try {
      if (usernameChanged) {
        newUsernameLockValue = username!;
        const usernameLock = await acquireUniqueLock(
          ctx,
          "username",
          newUsernameLockValue,
          authIdentityKey
        );
        if (!usernameLock.acquired && usernameLock.lock.ownerId !== authIdentityKey) {
          throw new Error("USERNAME_TAKEN: Username already taken");
        }
        acquiredNewUsernameLock = usernameLock.acquired;
      }

      // Build update object
      let nextAvatarUrl = avatarUrl;
      let nextAvatarObjectKey = avatarObjectKey;
      if (avatarUrl !== undefined && avatarObjectKey) {
        const isUnchangedManagedAvatar =
          profile.avatarObjectKey === avatarObjectKey || profile.avatarUrl === avatarUrl;
        if (!isUnchangedManagedAvatar) {
          const avatarSession = await consumeReadyUploadSessionByPublicUrl(ctx, {
            ownerProfileId: profile._id,
            publicUrl: avatarUrl,
            kind: "avatar",
          });
          nextAvatarObjectKey = avatarSession.objectKey;
        }
        nextAvatarUrl = undefined;
      }
      if (avatarUrl !== undefined && !avatarObjectKey) {
        nextAvatarObjectKey = undefined;
      }

      let nextBannerUrl = bannerUrl;
      let nextBannerObjectKey = bannerObjectKey;
      if (bannerUrl !== undefined && bannerObjectKey) {
        const isUnchangedManagedBanner =
          profile.bannerObjectKey === bannerObjectKey || profile.bannerUrl === bannerUrl;
        if (!isUnchangedManagedBanner) {
          const bannerSession = await consumeReadyUploadSessionByPublicUrl(ctx, {
            ownerProfileId: profile._id,
            publicUrl: bannerUrl,
            kind: "banner",
          });
          nextBannerObjectKey = bannerSession.objectKey;
        }
        nextBannerUrl = undefined;
      }
      if (bannerUrl !== undefined && !bannerObjectKey) {
        nextBannerObjectKey = undefined;
      }

      const updates: Partial<{
        username: string;
        displayName: string;
        avatarUrl: string | undefined;
        avatarObjectKey: string | undefined;
        bannerUrl: string | undefined;
        bannerObjectKey: string | undefined;
        bio: string;
        instruments: string[];
        genres: string[];
        dmPrivacy: "friends" | "everyone";
      }> = {};

      if (username !== undefined) updates.username = username;
      if (displayName !== undefined) updates.displayName = displayName;
      if (avatarUrl !== undefined) {
        updates.avatarUrl = nextAvatarUrl;
        updates.avatarObjectKey = nextAvatarObjectKey;
      }
      if (bannerUrl !== undefined) {
        updates.bannerUrl = nextBannerUrl;
        updates.bannerObjectKey = nextBannerObjectKey;
      }
      if (bio !== undefined) updates.bio = bio;
      if (instruments !== undefined) updates.instruments = instruments;
      if (genres !== undefined) updates.genres = genres;
      if (args.dm_privacy !== undefined) updates.dmPrivacy = args.dm_privacy;

      await ctx.db.patch(profile._id, updates);

      if (usernameChanged && newUsernameLockValue) {
        // Move username lock ownership from auth identity -> profile id for consistency.
        await setUniqueLockOwner(ctx, "username", newUsernameLockValue, profile._id);
        await releaseUniqueLock(ctx, "username", previousUsername, profile._id);
      }

      // Return updated profile
      const updated = await ctx.db.get(profile._id);
      if (!updated) {
        throw new Error("Failed to update profile");
      }
      return formatProfile(updated);
    } catch (error) {
      if (acquiredNewUsernameLock && newUsernameLockValue) {
        await releaseUniqueLock(ctx, "username", newUsernameLockValue, authIdentityKey);
      }
      throw error;
    }
  },
});

/**
 * Get a profile by username (public)
 * Equivalent to GET /profiles/:username
 */
export const getByUsername = query({
  args: {
    username: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedUsername = normalizeUsername(args.username);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", normalizedUsername ?? args.username))
      .first();

    if (!profile) {
      return null;
    }
    if (!isDiscoverableAccountState(profile.accountState)) {
      return null;
    }

    return formatProfile(profile);
  },
});

/**
 * Get the curated profile catalog used by profile/settings editors.
 */
export const getProfileCatalog = query({
  args: {},
  handler: async () => PROFILE_CATALOG,
});

/**
 * Soft delete the current user's account profile.
 * Content remains, identity is anonymized and username is released.
 */
export const softDeleteMe = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await requireAuth(ctx);
    await checkRateLimit(ctx, "deleteAction", profile._id);

    const currentState = resolveAccountState(profile.accountState);
    if (currentState === "deleted") {
      return formatProfile(profile);
    }
    assertValidAccountStateTransition(currentState, "deleted");

    const previousUsername = normalizeUsername(profile.username) ?? profile.username;
    const deletedUsername = await generateDeletedUsername(ctx, profile._id);

    await ctx.db.patch(profile._id, {
      username: deletedUsername,
      displayName: DELETED_ACCOUNT_DISPLAY_NAME,
      avatarUrl: "",
      avatarObjectKey: undefined,
      bannerUrl: "",
      bannerObjectKey: undefined,
      bio: "",
      instruments: [],
      genres: [],
      dmPrivacy: "friends",
      accountState: "deleted",
      stateChangedAt: Date.now(),
      stateReason: "user_requested_delete",
      stateUntil: undefined,
    });

    await releaseUniqueLock(ctx, "username", previousUsername, profile._id);

    const updated = await ctx.db.get(profile._id);
    if (!updated) {
      throw new Error("PROFILE_DELETE_FAILED: Failed to soft delete profile");
    }

    return formatProfile(updated);
  },
});

/**
 * Create a new profile for an authenticated user
 * Called after Better Auth registration
 * Rate limited: 3 requests per minute per user
 */
export const createProfile = mutation({
  args: {
    username: v.string(),
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Rate limit: 3 requests per minute per auth identity
    await checkRateLimit(ctx, "createProfile", `${identity.issuer}:${identity.subject}`);

    // Sanitize and validate inputs
    const usernameInput = normalizeUsername(sanitizeText(args.username));
    const displayName = sanitizeText(args.displayName);
    const avatarUrl = args.avatarUrl;
    const avatarObjectKey = extractManagedMediaObjectKeyFromUrl(avatarUrl);
    const authIdentityKey = `${identity.issuer}:${identity.subject}`;

    // Validate username (checks both min and max length, throws if invalid)
    validateUsername(usernameInput);
    // After validation, we know username is a valid non-empty string
    const username = usernameInput!;

    validateTextLength(displayName, MAX_LENGTHS.DISPLAY_NAME, "Display name");
    validateUrl(avatarUrl);
    if (avatarObjectKey) {
      throw new Error(
        "PROFILE_CREATE_MANAGED_AVATAR_NOT_ALLOWED: Create profile first, then upload avatar"
      );
    }

    // Check if profile already exists for this auth identity
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_auth_identity", (q) =>
        q.eq("authIssuer", identity.issuer).eq("authSubject", identity.subject)
      )
      .first();

    if (existing) {
      throw new Error("PROFILE_EXISTS: Profile already exists for this user");
    }

    // Check username uniqueness (CRITICAL: Server-side validation cannot be bypassed)
    const usernameExists = await ctx.db
      .query("profiles")
      .withIndex("by_username", (q) => q.eq("username", username))
      .first();

    if (usernameExists) {
      throw new Error("USERNAME_TAKEN: Username already taken");
    }

    let acquiredUsernameLock = false;
    try {
      const usernameLock = await acquireUniqueLock(
        ctx,
        "username",
        username,
        authIdentityKey
      );
      if (!usernameLock.acquired && usernameLock.lock.ownerId !== authIdentityKey) {
        throw new Error("USERNAME_TAKEN: Username already taken");
      }
      acquiredUsernameLock = usernameLock.acquired;

      // Create the profile
      const profileId = await ctx.db.insert("profiles", {
        authIssuer: identity.issuer,
        authSubject: identity.subject,
        username: username,
        displayName: displayName ?? username,
        avatarUrl: avatarUrl ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
        avatarObjectKey,
        bannerUrl: "",
        bannerObjectKey: undefined,
        bio: "",
        instruments: [],
        genres: [],
        accountState: "active",
        stateChangedAt: Date.now(),
        dmPrivacy: "friends",
      });

      await setUniqueLockOwner(ctx, "username", username, profileId);

      const profile = await ctx.db.get(profileId);
      if (!profile) {
        throw new Error("PROFILE_CREATE_FAILED: Failed to create profile");
      }

      return formatProfile(profile);
    } catch (error) {
      if (acquiredUsernameLock) {
        await releaseUniqueLock(ctx, "username", username, authIdentityKey);
      }
      throw error;
    }
  },
});

