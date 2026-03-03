import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Profiles table - equivalent to Prisma Profile model
  profiles: defineTable({
    // Auth identity (issuer + subject) for multi-provider support
    authIssuer: v.string(),
    authSubject: v.string(),
    username: v.string(),
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    avatarObjectKey: v.optional(v.string()),
    bannerUrl: v.optional(v.string()),
    bannerObjectKey: v.optional(v.string()),
    bio: v.optional(v.string()),
    instruments: v.optional(v.array(v.string())),
    genres: v.optional(v.array(v.string())),
    accountState: v.union(
      v.literal("active"),
      v.literal("deactivated"),
      v.literal("suspended"),
      v.literal("banned"),
      v.literal("deleted")
    ),
    stateChangedAt: v.number(),
    stateReason: v.optional(v.string()),
    stateUntil: v.optional(v.number()),
    dmPrivacy: v.union(v.literal("friends"), v.literal("everyone")),
  })
    .index("by_auth_identity", ["authIssuer", "authSubject"])
    .index("by_username", ["username"])
    .index("by_account_state", ["accountState"])
    .searchIndex("search_profiles", {
      searchField: "username",
      filterFields: ["_creationTime", "accountState"],
    }),

  // Posts table - top-level posts only (comments moved to separate table)
  posts: defineTable({
    authorId: v.id("profiles"),
    text: v.optional(v.string()),
    audioUrl: v.optional(v.string()),
    audioObjectKey: v.optional(v.string()),
    audioTitle: v.optional(v.string()),
    audioDuration: v.optional(v.number()),
    // Optional community association
    communityId: v.optional(v.id("communities")),
    // Denormalized counts for O(1) read performance
    likesCount: v.optional(v.number()),
    commentsCount: v.optional(v.number()),
    // Atomic sequence counter for generating unique comment paths
    // Guarantees no duplicate paths even under high concurrency
    nextCommentSequence: v.optional(v.number()),
    // Soft delete: set when post is deleted, used for placeholder rendering
    deletedAt: v.optional(v.number()),
  })
    .index("by_author", ["authorId"])
    .index("by_community", ["communityId"]),

  // Comments table - threaded comments with path-based ordering
  // Path format: "0001.0002.0003" enables efficient tree operations
  comments: defineTable({
    postId: v.id("posts"),
    authorId: v.id("profiles"),
    parentId: v.optional(v.id("comments")), // For replies to other comments
    path: v.string(), // e.g. "0001", "0001.0001", "0001.0001.0001"
    depth: v.number(), // 0 for top-level, 1 for first reply, etc.
    text: v.optional(v.string()),
    audioUrl: v.optional(v.string()),
    audioObjectKey: v.optional(v.string()),
    audioTitle: v.optional(v.string()),
    audioDuration: v.optional(v.number()),
    // Denormalized counts for O(1) read performance
    likesCount: v.optional(v.number()),
    repliesCount: v.optional(v.number()),
    // Atomic sequence counter for generating unique reply paths
    // Guarantees no duplicate paths even under high concurrency
    nextReplySequence: v.optional(v.number()),
    // Soft delete: set when comment is deleted, used for placeholder rendering
    deletedAt: v.optional(v.number()),
  })
    .index("by_post", ["postId"])
    .index("by_post_and_path", ["postId", "path"])
    .index("by_author", ["authorId"])
    .index("by_parent", ["parentId"]),

  // Post likes table - for posts
  post_likes: defineTable({
    postId: v.id("posts"),
    userId: v.id("profiles"),
  })
    .index("by_post", ["postId"])
    .index("by_user", ["userId"])
    .index("by_post_and_user", ["postId", "userId"]),

  // Comment likes table - separate from post likes to avoid cross-invalidation
  comment_likes: defineTable({
    commentId: v.id("comments"),
    userId: v.id("profiles"),
  })
    .index("by_comment", ["commentId"])
    .index("by_user", ["userId"])
    .index("by_comment_and_user", ["commentId", "userId"]),

  // Generic uniqueness locks used to prevent duplicate rows under concurrency.
  // scope examples: username, dm_pair, post_like, comment_like
  unique_locks: defineTable({
    scope: v.string(),
    value: v.string(),
    ownerId: v.string(),
    createdAt: v.number(),
  }).index("by_scope_value", ["scope", "value"]),

  // Upload sessions for strict direct-upload verification.
  // Flow: initiated -> ready (finalized) -> consumed (attached to entity)
  upload_sessions: defineTable({
    ownerProfileId: v.id("profiles"),
    kind: v.union(v.literal("avatar"), v.literal("banner"), v.literal("audio")),
    objectKey: v.string(),
    publicUrl: v.string(),
    contentType: v.string(),
    fileSize: v.number(),
    status: v.union(
      v.literal("initiated"),
      v.literal("ready"),
      v.literal("consumed"),
      v.literal("expired")
    ),
    expiresAt: v.number(),
    createdAt: v.number(),
    finalizedAt: v.optional(v.number()),
    usedAt: v.optional(v.number()),
  })
    .index("by_owner", ["ownerProfileId"])
    .index("by_public_url", ["publicUrl"])
    .index("by_status_expires", ["status", "expiresAt"]),

  // Friends table - for friend requests and friendships
  // BIDIRECTIONAL MODEL:
  // - Pending requests: ONE record (userId = requester, friendId = recipient)
  // - Accepted friendships: TWO records (one for each direction)
  friends: defineTable({
    userId: v.id("profiles"), // The owner of this friendship record
    friendId: v.id("profiles"), // The friend
    status: v.union(v.literal("pending"), v.literal("accepted")),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_user_and_status", ["userId", "status"]) // Optimized for filtering accepted friends
    .index("by_friend", ["friendId"])
    .index("by_friend_and_status", ["friendId", "status"])
    .index("by_user_and_friend", ["userId", "friendId"]),

  // Blocks table
  blocks: defineTable({
    blockerId: v.id("profiles"),
    blockedId: v.id("profiles"),
  })
    .index("by_blocker", ["blockerId"])
    .index("by_blocked", ["blockedId"])
    .index("by_blocker_and_blocked", ["blockerId", "blockedId"]),

  // Communities table
  communities: defineTable({
    name: v.string(),
    handle: v.string(), // unique, lowercase slug
    description: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    avatarObjectKey: v.optional(v.string()),
    bannerUrl: v.optional(v.string()),
    bannerObjectKey: v.optional(v.string()),
    themeColor: v.string(), // key from predefined palette (amber, purple, etc.)
    tags: v.array(v.string()), // max 5, from predefined list
    ownerId: v.id("profiles"),
    membersCount: v.number(),
    postsCount: v.number(),
    createdAt: v.number(),
  })
    .index("by_handle", ["handle"])
    .index("by_owner", ["ownerId"])
    .index("by_created_at", ["createdAt"])
    .searchIndex("search_communities", {
      searchField: "name",
      filterFields: ["themeColor"],
    }),

  // Community members table - tracks membership and roles
  community_members: defineTable({
    communityId: v.id("communities"),
    profileId: v.id("profiles"),
    role: v.union(v.literal("owner"), v.literal("mod"), v.literal("member")),
    joinedAt: v.number(),
  })
    .index("by_community", ["communityId"])
    .index("by_profile", ["profileId"])
    .index("by_community_and_profile", ["communityId", "profileId"])
    .index("by_community_and_role", ["communityId", "role"]),

  // Jam rooms — one per user, handle-based URLs
  // Presence tracked via @convex-dev/presence rooms ("room:{roomId}")
  rooms: defineTable({
    hostId: v.id("profiles"),
    handle: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    genre: v.optional(v.string()),
    maxPerformers: v.number(),
    isPrivate: v.boolean(),
    isActive: v.boolean(),
    streamUrl: v.optional(v.string()),
    status: v.union(v.literal("idle"), v.literal("live")),
    communityId: v.optional(v.id("communities")),
    lastActiveAt: v.number(),
  })
    .index("by_host", ["hostId"])
    .index("by_handle", ["handle"])
    .index("by_active", ["isActive"]),

  // Room chat messages — live chat, latest 30 only
  room_messages: defineTable({
    roomId: v.id("rooms"),
    senderId: v.id("profiles"),
    text: v.string(),
  })
    .index("by_room", ["roomId"]),

  // DM lookup table - provides practical uniqueness for 1:1 conversations
  // Uses _creationTime for canonical selection (no custom timestamp needed)
  dm_keys: defineTable({
    dmKey: v.string(), // "idA:idB" lexicographically sorted
    conversationId: v.id("conversations"),
  })
    .index("by_dmKey", ["dmKey"])
    .index("by_conversation", ["conversationId"]),
  // Conversations table - supports 1:1 now, groups later
  conversations: defineTable({
    isGroup: v.boolean(), // Always false for now
    name: v.optional(v.string()), // For future group names
    // Denormalized for O(1) unread check (avoids N+1)
    lastMessageAt: v.optional(v.number()),
    // Denormalized last message preview for conversation list rendering.
    lastMessageId: v.optional(v.id("messages")),
    lastMessageSenderId: v.optional(v.id("profiles")),
    lastMessageText: v.optional(v.string()),
    lastMessageAudioUrl: v.optional(v.string()),
    lastMessageAudioObjectKey: v.optional(v.string()),
    lastMessageCreatedAt: v.optional(v.number()),
    // For duplicate DM cleanup - points to canonical conversation
    mergedIntoConversationId: v.optional(v.id("conversations")),
  })
    .index("by_lastMessageAt", ["lastMessageAt"]),

  // Participants - who's in each conversation + read tracking
  conversation_participants: defineTable({
    conversationId: v.id("conversations"),
    profileId: v.id("profiles"),
    // Uses message _creationTime (not wall clock) - prevents clock skew
    lastReadMessageAt: v.optional(v.number()),
    // Denormalized activity timestamp for conversation list ordering
    lastActivityAt: v.optional(v.number()),
    joinedAt: v.number(),
    // Track if conversation is active (false when merged into another conversation)
    isActive: v.optional(v.boolean()),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_profile", ["profileId"])
    .index("by_profile_active", ["profileId", "isActive"])
    .index("by_profile_and_last_activity", ["profileId", "lastActivityAt"])
    .index("by_conversation_and_profile", ["conversationId", "profileId"]),

  // Messages table - DM messages with index for cursor pagination
  // Note: Convex automatically appends _creationTime to all indexes
  messages: defineTable({
    conversationId: v.id("conversations"),
    senderId: v.id("profiles"),
    text: v.optional(v.string()),
    audioUrl: v.optional(v.string()),
    audioObjectKey: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_conversation_time", ["conversationId"])
    .index("by_sender", ["senderId"]),
});

