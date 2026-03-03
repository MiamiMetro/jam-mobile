import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { resolvePublicMediaUrl } from "./mediaService";

// ============================================
// Input Validation Constants & Utilities
// ============================================

/** Maximum lengths for user-generated content */
export const MAX_LENGTHS = {
  POST_TEXT: 5000,
  COMMENT_TEXT: 2000,
  MESSAGE_TEXT: 300,
  USERNAME: 15, // Like Twitter/X
  DISPLAY_NAME: 50,
  BIO: 500,
  PROFILE_TAG: 24,
  URL: 2048,
  COMMUNITY_NAME: 50,
  COMMUNITY_HANDLE: 30,
  COMMUNITY_DESCRIPTION: 500,
  COMMUNITY_TAG: 30,
  ROOM_NAME: 50,
  ROOM_HANDLE: 30,
  ROOM_DESCRIPTION: 500,
  ROOM_MESSAGE: 300,
} as const;

/** Minimum lengths for user-generated content */
export const MIN_LENGTHS = {
  USERNAME: 3,
  COMMUNITY_HANDLE: 2,
  COMMUNITY_NAME: 2,
  ROOM_HANDLE: 2,
  ROOM_NAME: 2,
} as const;

export const MAX_COUNTS = {
  PROFILE_TAGS: 8,
} as const;

export const ACCOUNT_STATES = [
  "active",
  "deactivated",
  "suspended",
  "banned",
  "deleted",
] as const;

export type AccountState = (typeof ACCOUNT_STATES)[number];

export const DELETED_ACCOUNT_USERNAME = "deleted_account";
export const DELETED_ACCOUNT_DISPLAY_NAME = "Deleted Account";
export const RESERVED_USERNAMES = new Set<string>([
  DELETED_ACCOUNT_USERNAME,
  "deleted",
  "admin",
  "support",
  "system",
]);

const ALLOWED_ACCOUNT_STATE_TRANSITIONS: Record<AccountState, readonly AccountState[]> = {
  active: ["deactivated", "suspended", "banned", "deleted"],
  deactivated: ["active", "deleted"],
  suspended: ["active", "banned"],
  banned: ["active"],
  deleted: [],
} as const;

/**
 * Validate text length and throw if exceeded
 */
export function validateTextLength(
  text: string | undefined,
  maxLength: number,
  fieldName: string
): void {
  if (text && text.length > maxLength) {
    throw new Error(`${fieldName} exceeds maximum length of ${maxLength} characters`);
  }
}

/**
 * Validate username:
 * - Length: 3-15 characters (same as Twitter/X)
 * - Allowed: letters (a-z, A-Z), numbers (0-9), underscores (_)
 * - Must start with a letter or number (not underscore)
 * - Case insensitive (stored as lowercase for consistency)
 *
 * This prevents:
 * - URL slug issues (safe for jam.com/username)
 * - Impersonation with Unicode lookalikes
 * - XSS attacks with special characters
 * - Confusion with spaces or special symbols
 */
export function validateUsername(username: string | undefined): void {
  if (!username) {
    throw new Error("USERNAME_REQUIRED: Username is required");
  }

  const trimmed = username.trim();
  const normalized = trimmed.toLowerCase();

  if (trimmed.length < MIN_LENGTHS.USERNAME) {
    throw new Error(`USERNAME_TOO_SHORT: Username must be at least ${MIN_LENGTHS.USERNAME} characters`);
  }

  if (trimmed.length > MAX_LENGTHS.USERNAME) {
    throw new Error(`USERNAME_TOO_LONG: Username exceeds maximum length of ${MAX_LENGTHS.USERNAME} characters`);
  }

  if (RESERVED_USERNAMES.has(normalized)) {
    throw new Error("USERNAME_RESERVED: Username is reserved");
  }

  // Only allow letters, numbers, and underscores (like Twitter)
  // Must start with letter or number (not underscore)
  const usernameRegex = /^[a-zA-Z0-9][a-zA-Z0-9_]*$/;

  if (!usernameRegex.test(trimmed)) {
    throw new Error(
      "USERNAME_INVALID_CHARS: Username can only contain letters, numbers, and underscores, and must start with a letter or number"
    );
  }
}

/**
 * Validate and normalize a community handle:
 * - Length: 2-30 characters
 * - Allowed: lowercase letters (a-z), numbers (0-9), hyphens (-), underscores (_)
 * - Must start and end with a letter or number (no leading/trailing hyphens or underscores)
 * - Returns the normalized (lowercased, trimmed) handle
 */
export function validateCommunityHandle(handle: string | undefined): string {
  if (!handle) {
    throw new Error("HANDLE_REQUIRED: Community handle is required");
  }

  const normalized = handle.trim().toLowerCase();

  if (normalized.length < MIN_LENGTHS.COMMUNITY_HANDLE) {
    throw new Error(`HANDLE_TOO_SHORT: Handle must be at least ${MIN_LENGTHS.COMMUNITY_HANDLE} characters`);
  }

  if (normalized.length > MAX_LENGTHS.COMMUNITY_HANDLE) {
    throw new Error(`HANDLE_TOO_LONG: Handle exceeds maximum length of ${MAX_LENGTHS.COMMUNITY_HANDLE} characters`);
  }

  // Must start and end with letter/number; allows hyphens and underscores in the middle
  const handleRegex = /^[a-z0-9][a-z0-9_-]*[a-z0-9]$|^[a-z0-9]{1,2}$/;
  if (!handleRegex.test(normalized)) {
    throw new Error(
      "HANDLE_INVALID: Handle can only contain lowercase letters, numbers, hyphens, and underscores, and must start and end with a letter or number"
    );
  }

  return normalized;
}

/**
 * Validate and normalize a room handle:
 * - Length: 2-30 characters
 * - Allowed: lowercase letters (a-z), numbers (0-9), hyphens (-), underscores (_)
 * - Must start and end with a letter or number (no leading/trailing hyphens or underscores)
 * - Returns the normalized (lowercased, trimmed) handle
 */
export function validateRoomHandle(handle: string | undefined): string {
  if (!handle) {
    throw new Error("HANDLE_REQUIRED: Room handle is required");
  }

  const normalized = handle.trim().toLowerCase();

  if (normalized.length < MIN_LENGTHS.ROOM_HANDLE) {
    throw new Error(`HANDLE_TOO_SHORT: Handle must be at least ${MIN_LENGTHS.ROOM_HANDLE} characters`);
  }

  if (normalized.length > MAX_LENGTHS.ROOM_HANDLE) {
    throw new Error(`HANDLE_TOO_LONG: Handle exceeds maximum length of ${MAX_LENGTHS.ROOM_HANDLE} characters`);
  }

  const handleRegex = /^[a-z0-9][a-z0-9_-]*[a-z0-9]$|^[a-z0-9]{1,2}$/;
  if (!handleRegex.test(normalized)) {
    throw new Error(
      "HANDLE_INVALID: Handle can only contain lowercase letters, numbers, hyphens, and underscores, and must start and end with a letter or number"
    );
  }

  return normalized;
}

/**
 * Validate URL format (basic check)
 */
export function validateUrl(url: string | undefined): void {
  if (!url) return;
  if (url.length > MAX_LENGTHS.URL) {
    throw new Error(`URL exceeds maximum length of ${MAX_LENGTHS.URL} characters`);
  }
  // Basic URL format check
  try {
    new URL(url);
  } catch {
    throw new Error("Invalid URL format");
  }
}

/**
 * Sanitize text by trimming whitespace
 */
export function sanitizeText(text: string | undefined): string | undefined {
  return text?.trim();
}

/**
 * Normalize profile tags while preserving user-friendly casing.
 * Dedupe is case-insensitive and order-preserving.
 */
export function sanitizeProfileTags(
  tags: string[] | undefined,
  fieldName: "Instruments" | "Genres"
): string[] | undefined {
  if (tags === undefined) return undefined;

  if (tags.length > MAX_COUNTS.PROFILE_TAGS) {
    throw new Error(`${fieldName} supports a maximum of ${MAX_COUNTS.PROFILE_TAGS} tags`);
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of tags) {
    const value = raw.trim().replace(/\s+/g, " ");
    if (!value) continue;

    validateTextLength(value, MAX_LENGTHS.PROFILE_TAG, fieldName);

    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }

  return normalized;
}

// ============================================
// Authentication Helpers
// ============================================

/**
 * Get the current user's profile from their auth identity in the auth token
 * Returns null if not authenticated or profile doesn't exist
 */
export async function getCurrentProfile(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }

  const authIssuer = identity.issuer;
  const authSubject = identity.subject;

  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_auth_identity", (q) =>
      q.eq("authIssuer", authIssuer).eq("authSubject", authSubject)
    )
    .first();

  return profile;
}

/**
 * Get the current user's profile, throwing an error if not authenticated
 */
export async function requireAuth(ctx: QueryCtx | MutationCtx) {
  const profile = await getCurrentProfile(ctx);
  if (!profile) {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("NOT_AUTHENTICATED: You must be signed in");
    }
    throw new Error("PROFILE_REQUIRED: You must create a profile before performing this action");
  }
  return profile;
}

/**
 * Normalize username for canonical storage and case-insensitive uniqueness.
 */
export function normalizeUsername(username: string | undefined): string | undefined {
  const trimmed = username?.trim();
  if (!trimmed) return trimmed;
  return trimmed.toLowerCase();
}

export function isDiscoverableAccountState(
  state: AccountState | undefined
): boolean {
  return (state ?? "active") === "active";
}

export function resolveAccountState(state: AccountState | undefined): AccountState {
  return state ?? "active";
}

export function assertValidAccountStateTransition(
  from: AccountState,
  to: AccountState
): void {
  if (from === to) return;
  const allowed = ALLOWED_ACCOUNT_STATE_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new Error(`ACCOUNT_STATE_TRANSITION_INVALID: ${from} -> ${to}`);
  }
}

/**
 * Check if there's a block between two users (in either direction)
 */
export async function isBlocked(
  ctx: QueryCtx | MutationCtx,
  userId1: Id<"profiles">,
  userId2: Id<"profiles">
): Promise<boolean> {
  // Check if user1 blocked user2
  const block1 = await ctx.db
    .query("blocks")
    .withIndex("by_blocker_and_blocked", (q) =>
      q.eq("blockerId", userId1).eq("blockedId", userId2)
    )
    .first();

  if (block1) return true;

  // Check if user2 blocked user1
  const block2 = await ctx.db
    .query("blocks")
    .withIndex("by_blocker_and_blocked", (q) =>
      q.eq("blockerId", userId2).eq("blockedId", userId1)
    )
    .first();

  return !!block2;
}

/**
 * Check if two users are friends (accepted status)
 * OPTIMIZED: Only queries one direction thanks to bidirectional records!
 */
export async function areFriends(
  ctx: QueryCtx | MutationCtx,
  userId1: Id<"profiles">,
  userId2: Id<"profiles">
): Promise<boolean> {
  // With bidirectional records, we only need to check one direction
  const friendship = await ctx.db
    .query("friends")
    .withIndex("by_user_and_friend", (q) =>
      q.eq("userId", userId1).eq("friendId", userId2)
    )
    .first();

  return friendship?.status === "accepted";
}

export type UniqueLockScope =
  | "username"
  | "dm_pair"
  | "post_like"
  | "comment_like"
  | "community_handle"
  | "room_handle";

export async function getUniqueLock(
  ctx: QueryCtx | MutationCtx,
  scope: UniqueLockScope,
  value: string
) {
  return await ctx.db
    .query("unique_locks")
    .withIndex("by_scope_value", (q) => q.eq("scope", scope).eq("value", value))
    .first();
}

export async function acquireUniqueLock(
  ctx: MutationCtx,
  scope: UniqueLockScope,
  value: string,
  ownerId: string
) {
  const existing = await getUniqueLock(ctx, scope, value);
  if (existing) {
    return { acquired: false as const, lock: existing };
  }

  const lockId = await ctx.db.insert("unique_locks", {
    scope,
    value,
    ownerId,
    createdAt: Date.now(),
  });

  const lock = await ctx.db.get(lockId);
  if (!lock) {
    throw new Error("UNIQUE_LOCK_CREATE_FAILED");
  }

  return { acquired: true as const, lock };
}

export async function setUniqueLockOwner(
  ctx: MutationCtx,
  scope: UniqueLockScope,
  value: string,
  ownerId: string
): Promise<boolean> {
  const lock = await getUniqueLock(ctx, scope, value);
  if (!lock) return false;
  await ctx.db.patch(lock._id, { ownerId });
  return true;
}

export async function releaseUniqueLock(
  ctx: MutationCtx,
  scope: UniqueLockScope,
  value: string,
  ownerId?: string
): Promise<boolean> {
  const lock = await getUniqueLock(ctx, scope, value);
  if (!lock) return false;
  if (ownerId && lock.ownerId !== ownerId) return false;
  await ctx.db.delete(lock._id);
  return true;
}

/**
 * Format profile for API response
 */
type ProfileForFormatting = {
  _id: Id<"profiles">;
  _creationTime: number;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  avatarObjectKey?: string;
  bannerUrl?: string;
  bannerObjectKey?: string;
  bio?: string;
  instruments?: string[];
  genres?: string[];
  accountState?: AccountState;
  stateChangedAt?: number;
  dmPrivacy?: "friends" | "everyone";
};

function getPublicProfileFields(profile: ProfileForFormatting) {
  const accountState = profile.accountState ?? "active";
  const stateChangedAt = profile.stateChangedAt ?? profile._creationTime;
  const isDeleted = accountState === "deleted";

  return {
    id: profile._id,
    username: isDeleted ? DELETED_ACCOUNT_USERNAME : profile.username,
    display_name: isDeleted
      ? DELETED_ACCOUNT_DISPLAY_NAME
      : profile.displayName ?? "",
    avatar_url: isDeleted
      ? ""
      : resolvePublicMediaUrl({
          url: profile.avatarUrl,
          objectKey: profile.avatarObjectKey,
        }),
    banner_url: isDeleted
      ? ""
      : resolvePublicMediaUrl({
          url: profile.bannerUrl,
          objectKey: profile.bannerObjectKey,
        }),
    bio: isDeleted ? "" : profile.bio ?? "",
    instruments: isDeleted ? [] : profile.instruments ?? [],
    genres: isDeleted ? [] : profile.genres ?? [],
    dm_privacy: profile.dmPrivacy ?? "friends",
    account_state: accountState,
    state_changed_at: new Date(stateChangedAt).toISOString(),
    created_at: new Date(profile._creationTime).toISOString(),
  };
}

export function formatPublicProfileIdentity(profile: ProfileForFormatting) {
  const normalized = getPublicProfileFields(profile);
  return {
    id: normalized.id,
    username: normalized.username,
    display_name: normalized.display_name,
    avatar_url: normalized.avatar_url,
  };
}

/**
 * Format profile for API response
 */
export function formatProfile(profile: ProfileForFormatting) {
  return getPublicProfileFields(profile);
}

