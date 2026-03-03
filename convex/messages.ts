import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id, Doc } from "./_generated/dataModel";
import {
  extractManagedMediaObjectKeyFromUrl,
  resolvePublicMediaUrl,
} from "./mediaService";
import { consumeReadyUploadSessionByPublicUrl } from "./uploadSessions";
import {
  formatPublicProfileIdentity,
  getCurrentProfile,
  isDiscoverableAccountState,
  requireAuth,
  isBlocked,
  areFriends,
  getUniqueLock,
  acquireUniqueLock,
  validateTextLength,
  validateUrl,
  sanitizeText,
  MAX_LENGTHS,
} from "./helpers";
import { checkRateLimit } from "./rateLimiter";

/**
 * Mark participants of a merged conversation as inactive.
 * Call this when merging duplicate conversations.
 *
 * Helper function for conversation merge features. This function is part of the public API.
 * Uses batched processing to prevent OOM on large group conversations.
 */
export async function markConversationAsInactive(
  ctx: MutationCtx,
  conversationId: Id<"conversations">
): Promise<void> {
  // Process in cursor-based batches to avoid re-reading the same first page.
  let cursor: string | null = null;
  let isDone = false;

  while (!isDone) {
    const page = await ctx.db
      .query("conversation_participants")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .paginate({ cursor, numItems: 100 });

    for (const participant of page.page) {
      if (participant.isActive !== false) {
        await ctx.db.patch(participant._id, { isActive: false });
      }
    }

    cursor = page.continueCursor;
    isDone = page.isDone;
  }
}

/**
 * Find or create a DM conversation between two users
 * Uses dm_keys for practical uniqueness with deterministic canonical selection
 */
async function findOrCreateDM(
  ctx: MutationCtx,
  profileA: Id<"profiles">,
  profileB: Id<"profiles">
): Promise<{ conversationId: Id<"conversations"> }> {
  const dmKey = profileA < profileB ? `${profileA}:${profileB}` : `${profileB}:${profileA}`;
  const now = Date.now();

  const ensureParticipant = async (
    conversationId: Id<"conversations">,
    profileId: Id<"profiles">
  ) => {
    const participant = await ctx.db
      .query("conversation_participants")
      .withIndex("by_conversation_and_profile", (q) =>
        q.eq("conversationId", conversationId).eq("profileId", profileId)
      )
      .first();

    if (!participant) {
      await ctx.db.insert("conversation_participants", {
        conversationId,
        profileId,
        joinedAt: now,
        isActive: true,
        lastActivityAt: now,
      });
      return;
    }

    if (participant.isActive === false) {
      await ctx.db.patch(participant._id, {
        isActive: true,
        lastActivityAt: participant.lastActivityAt ?? now,
      });
    }
  };

  const existingLock = await getUniqueLock(ctx, "dm_pair", dmKey);
  if (existingLock) {
    const lockedConversationId = existingLock.ownerId as Id<"conversations">;
    const lockedConversation = await ctx.db.get(lockedConversationId);
    const canonicalConversationId =
      lockedConversation?.mergedIntoConversationId ?? lockedConversation?._id;

    if (canonicalConversationId) {
      await ensureParticipant(canonicalConversationId, profileA);
      await ensureParticipant(canonicalConversationId, profileB);
      return { conversationId: canonicalConversationId };
    }

    await ctx.db.delete(existingLock._id);
  }

  // Create conversation first, then claim uniqueness lock.
  // If we lose the lock race, this tentative conversation is cleaned up.
  const createdConversationId = await ctx.db.insert("conversations", {
    isGroup: false,
  });

  await ctx.db.insert("conversation_participants", {
    conversationId: createdConversationId,
    profileId: profileA,
    joinedAt: now,
    isActive: true,
    lastActivityAt: now,
  });
  await ctx.db.insert("conversation_participants", {
    conversationId: createdConversationId,
    profileId: profileB,
    joinedAt: now,
    isActive: true,
    lastActivityAt: now,
  });

  const lockResult = await acquireUniqueLock(
    ctx,
    "dm_pair",
    dmKey,
    createdConversationId
  );

  if (lockResult.acquired) {
    return { conversationId: createdConversationId };
  }

  // Lost lock race; remove tentative records and use winning conversation.
  const createdParticipants = await ctx.db
    .query("conversation_participants")
    .withIndex("by_conversation", (q) =>
      q.eq("conversationId", createdConversationId)
    )
    .take(10);
  for (const participant of createdParticipants) {
    await ctx.db.delete(participant._id);
  }
  await ctx.db.delete(createdConversationId);

  const winningConversationId = lockResult.lock.ownerId as Id<"conversations">;
  const winningConversation = await ctx.db.get(winningConversationId);
  const canonicalConversationId =
    winningConversation?.mergedIntoConversationId ?? winningConversation?._id;

  if (!canonicalConversationId) {
    throw new Error("DM_CREATE_FAILED: Could not resolve conversation");
  }

  await ensureParticipant(canonicalConversationId, profileA);
  await ensureParticipant(canonicalConversationId, profileB);
  return { conversationId: canonicalConversationId };
}

/**
 * Ensure a DM conversation exists with another user and return its ID.
 */
export const ensureDmWithUser = mutation({
  args: {
    userId: v.id("profiles"),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);

    await checkRateLimit(ctx, "general", profile._id);

    if (profile._id === args.userId) {
      throw new Error("You cannot create a DM with yourself");
    }

    const otherUser = await ctx.db.get(args.userId);
    if (!otherUser) {
      throw new Error("User not found");
    }
    if (!isDiscoverableAccountState(otherUser.accountState)) {
      throw new Error("Cannot start a conversation with this user");
    }

    const blocked = await isBlocked(ctx, profile._id, args.userId);
    if (blocked) {
      throw new Error("Cannot start a conversation with this user");
    }

    const friends = await areFriends(ctx, profile._id, args.userId);
    if (!friends && otherUser.dmPrivacy !== "everyone") {
      throw new Error(
        "You can only send messages to friends or users who allow messages from everyone"
      );
    }

    const { conversationId } = await findOrCreateDM(ctx, profile._id, args.userId);
    return { conversationId };
  },
});

/**
 * Send a message to an existing conversation.
 */
export const send = mutation({
  args: {
    conversationId: v.id("conversations"),
    text: v.optional(v.string()),
    audio_url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    
    // Rate limit: 30 messages per minute
    await checkRateLimit(ctx, "sendMessage", profile._id);

    // Sanitize and validate inputs
    const text = sanitizeText(args.text);
    const audioUrl = args.audio_url;
    const audioObjectKey = extractManagedMediaObjectKeyFromUrl(audioUrl);
    
    validateTextLength(text, MAX_LENGTHS.MESSAGE_TEXT, "Message text");
    validateUrl(audioUrl);

    // Text or audio must be provided
    if (!text && !audioUrl) {
      throw new Error("Message must have either text or audio");
    }

    let nextAudioUrl = audioUrl;
    let nextAudioObjectKey = audioObjectKey;
    if (audioUrl && audioObjectKey) {
      const audioSession = await consumeReadyUploadSessionByPublicUrl(ctx, {
        ownerProfileId: profile._id,
        publicUrl: audioUrl,
        kind: "audio",
      });
      nextAudioObjectKey = audioSession.objectKey;
      nextAudioUrl = undefined;
    }
    if (audioUrl && !audioObjectKey) {
      nextAudioObjectKey = undefined;
    }

    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }
    if (conversation.mergedIntoConversationId != null) {
      throw new Error("Conversation has been merged");
    }

    const senderParticipant = await ctx.db
      .query("conversation_participants")
      .withIndex("by_conversation_and_profile", (q) =>
        q.eq("conversationId", args.conversationId).eq("profileId", profile._id)
      )
      .first();
    if (!senderParticipant || senderParticipant.isActive === false) {
      throw new Error("You are not a participant in this conversation");
    }

    if (!conversation.isGroup) {
      const participants = await ctx.db
        .query("conversation_participants")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", args.conversationId)
        )
        .take(50);

      const otherParticipants = participants.filter(
        (participant) =>
          participant.profileId !== profile._id && participant.isActive !== false
      );

      for (const other of otherParticipants) {
        const blocked = await isBlocked(ctx, profile._id, other.profileId);
        if (blocked) {
          throw new Error("BLOCKED_CANNOT_MESSAGE: Cannot send messages to this user");
        }

        const otherProfile = await ctx.db.get(other.profileId);
        if (!otherProfile || !isDiscoverableAccountState(otherProfile.accountState)) {
          throw new Error("Cannot send messages to this user");
        }

        const friends = await areFriends(ctx, profile._id, other.profileId);
        if (!friends && otherProfile.dmPrivacy !== "everyone") {
          throw new Error(
            "DM_PRIVACY_RESTRICTED: This user only accepts messages from friends"
          );
        }
      }
    }

    // Insert message
    const messageId = await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      senderId: profile._id,
      text: text,
      audioUrl: nextAudioUrl,
      audioObjectKey: nextAudioObjectKey,
    });

    // Get message to access _creationTime
    const message = await ctx.db.get(messageId);

    // Update conversation's lastMessageAt
    await ctx.db.patch(args.conversationId, {
      lastMessageAt: message!._creationTime,
      lastMessageId: message!._id,
      lastMessageSenderId: message!.senderId,
      lastMessageText: message!.text,
      lastMessageAudioUrl: message!.audioUrl,
      lastMessageAudioObjectKey: message!.audioObjectKey,
      lastMessageCreatedAt: message!._creationTime,
    });

    // Update participant activity timestamps for stable conversation ordering.
    let participantCursor: string | null = null;
    let participantIsDone = false;
    while (!participantIsDone) {
      const participantPage = await ctx.db
        .query("conversation_participants")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", args.conversationId)
        )
        .paginate({ cursor: participantCursor, numItems: 100 });

      for (const participant of participantPage.page) {
        if (participant._id === senderParticipant._id) {
          // Sender should not see their own new message as unread.
          await ctx.db.patch(participant._id, {
            lastReadMessageAt: message!._creationTime,
            lastActivityAt: message!._creationTime,
          });
        } else {
          await ctx.db.patch(participant._id, {
            lastActivityAt: message!._creationTime,
          });
        }
      }

      participantCursor = participantPage.continueCursor;
      participantIsDone = participantPage.isDone;
    }

    return {
      id: message!._id,
      conversation_id: message!.conversationId,
      sender_id: message!.senderId,
      text: message!.text ?? "",
      audio_url: resolvePublicMediaUrl({
        url: message!.audioUrl,
        objectKey: message!.audioObjectKey,
      }),
      created_at: new Date(message!._creationTime).toISOString(),
    };
  },
});

/**
 * Get list of conversations with unread status using native Convex pagination.
 * Preferred for Convex-first frontend pagination.
 */
export const getConversationsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const profile = await getCurrentProfile(ctx);
    if (!profile) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const result = await ctx.db
      .query("conversation_participants")
      .withIndex("by_profile_and_last_activity", (q) =>
        q.eq("profileId", profile._id)
      )
      .order("desc")
      .filter((q) => q.neq(q.field("isActive"), false))
      .paginate(args.paginationOpts);

    const entries = (
      await Promise.all(
        result.page.map(async (participantRow) => {
          const conversation = await ctx.db.get(participantRow.conversationId);
          if (!conversation || conversation.mergedIntoConversationId != null) {
            return null;
          }
          return { participantRow, conversation };
        })
      )
    ).filter(
      (
        entry
      ): entry is {
        participantRow: Doc<"conversation_participants">;
        conversation: Doc<"conversations">;
      } => entry !== null
    );

    const participantRowsByConversation = new Map<
      Id<"conversations">,
      Doc<"conversation_participants">[]
    >();
    await Promise.all(
      entries.map(async ({ conversation }) => {
        // Convex allows only one paginated query per function. Since this query
        // already uses pagination for the outer list, load conversation
        // participants with a bounded non-paginated read.
        const rows = await ctx.db
          .query("conversation_participants")
          .withIndex("by_conversation", (q) =>
            q.eq("conversationId", conversation._id)
          )
          .take(200);

        participantRowsByConversation.set(
          conversation._id,
          rows.filter((row) => row.isActive !== false)
        );
      })
    );

    const otherProfileIds = new Set<Id<"profiles">>();
    for (const { conversation } of entries) {
      if (conversation.isGroup) continue;
      const participants = participantRowsByConversation.get(conversation._id) ?? [];
      const other = participants.find((row) => row.profileId !== profile._id);
      if (other) {
        otherProfileIds.add(other.profileId);
      }
    }

    const otherProfiles = await Promise.all(
      [...otherProfileIds].map(async (profileId) => [profileId, await ctx.db.get(profileId)] as const)
    );
    const otherProfileMap = new Map(otherProfiles);

    const conversations = entries.map(({ participantRow, conversation }) => {
      const hasUnread =
        conversation.lastMessageAt != null &&
        (participantRow.lastReadMessageAt ?? 0) < conversation.lastMessageAt;

      const activeParticipants =
        participantRowsByConversation.get(conversation._id) ?? [];

      let otherUser: {
        id: Id<"profiles">;
        username: string;
        display_name: string;
        avatar_url: string;
      } | null = null;

      if (!conversation.isGroup) {
        const otherParticipant = activeParticipants.find(
          (row) => row.profileId !== profile._id
        );
        if (otherParticipant) {
          const otherProfile = otherProfileMap.get(otherParticipant.profileId);
          if (otherProfile) {
            const publicOther = formatPublicProfileIdentity(otherProfile);
            otherUser = {
              id: publicOther.id,
              username: publicOther.username,
              display_name: publicOther.display_name,
              avatar_url: publicOther.avatar_url,
            };
          }
        }
      }

      const lastMessage =
        conversation.lastMessageId &&
        conversation.lastMessageSenderId &&
        conversation.lastMessageCreatedAt != null
          ? {
              id: conversation.lastMessageId,
              conversation_id: conversation._id,
              sender_id: conversation.lastMessageSenderId,
              text: conversation.lastMessageText ?? "",
              audio_url: resolvePublicMediaUrl({
                url: conversation.lastMessageAudioUrl,
                objectKey: conversation.lastMessageAudioObjectKey,
              }),
              created_at: new Date(conversation.lastMessageCreatedAt).toISOString(),
            }
          : null;

      return {
        id: conversation._id,
        isGroup: conversation.isGroup,
        name: conversation.name,
        participant_count: activeParticipants.length,
        hasUnread,
        other_user: conversation.isGroup ? null : otherUser,
        last_message: lastMessage,
        updated_at: new Date(
          participantRow.lastActivityAt ?? conversation.lastMessageAt ?? participantRow._creationTime
        ).toISOString(),
      };
    });

    return {
      ...result,
      page: conversations.filter(
        (
          conversation
        ): conversation is NonNullable<(typeof conversations)[number]> =>
          conversation !== null
      ),
    };
  },
});

/**
 * Get messages by conversation ID.
 * Supports reverse cursor pagination (scroll up to load older).
 */
export const getByConversationPaginated = query({
  args: {
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.number()), // _creationTime as cursor
  },
  handler: async (ctx, args) => {
    const profile = await getCurrentProfile(ctx);
    if (!profile) {
      return {
        data: [],
        hasMore: false,
        nextCursor: null,
        lastReadMessageAt: null,
        otherParticipantLastRead: null,
      };
    }

    const participant = await ctx.db
      .query("conversation_participants")
      .withIndex("by_conversation_and_profile", (q) =>
        q.eq("conversationId", args.conversationId).eq("profileId", profile._id)
      )
      .first();
    if (!participant || participant.isActive === false) {
      throw new Error("Conversation not found");
    }

    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.mergedIntoConversationId != null) {
      throw new Error("Conversation not found");
    }

    const limit = args.limit ?? 50;

    let results: Doc<"messages">[];
    if (args.cursor == null) {
      results = await ctx.db
        .query("messages")
        .withIndex("by_conversation_time", (q) =>
          q.eq("conversationId", args.conversationId)
        )
        .order("desc")
        .take(limit + 1);
    } else {
      results = await ctx.db
        .query("messages")
        .withIndex("by_conversation_time", (q) =>
          q.eq("conversationId", args.conversationId).lt("_creationTime", args.cursor!)
        )
        .order("desc")
        .take(limit + 1);
    }

    const hasMore = results.length > limit;
    const data = results.slice(0, limit);
    const nextCursor =
      hasMore && data.length > 0 ? data[data.length - 1]._creationTime : null;

    const formattedMessages = data.reverse().map((msg) => {
      const isDeleted = msg.deletedAt != null;
      return {
        id: msg._id,
        conversation_id: msg.conversationId,
        sender_id: msg.senderId,
        text: isDeleted ? "" : (msg.text ?? ""),
        audio_url: isDeleted ? null : resolvePublicMediaUrl({
          url: msg.audioUrl,
          objectKey: msg.audioObjectKey,
        }),
        deleted_at: msg.deletedAt ?? null,
        created_at: new Date(msg._creationTime).toISOString(),
        _creationTime: msg._creationTime,
      };
    });

    const participantPage = await ctx.db
      .query("conversation_participants")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .take(50);

    const otherParticipant = participantPage.find(
      (p) => p.profileId !== profile._id && p.isActive !== false
    );

    return {
      data: formattedMessages,
      hasMore,
      nextCursor,
      lastReadMessageAt: participant.lastReadMessageAt ?? null,
      otherParticipantLastRead: otherParticipant?.lastReadMessageAt ?? null,
    };
  },
});

/**
 * Get participants for a conversation.
 */
export const getParticipants = query({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const profile = await getCurrentProfile(ctx);
    if (!profile) return [];

    const membership = await ctx.db
      .query("conversation_participants")
      .withIndex("by_conversation_and_profile", (q) =>
        q.eq("conversationId", args.conversationId).eq("profileId", profile._id)
      )
      .first();
    if (!membership || membership.isActive === false) {
      return [];
    }

    const participants = await ctx.db
      .query("conversation_participants")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .take(50);

    const profiles = await Promise.all(
      participants
        .filter((p) => p.isActive !== false)
        .map((participant) => ctx.db.get(participant.profileId))
    );

    return profiles
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map((p) => formatPublicProfileIdentity(p));
  },
});

/**
 * Mark conversation as read
 * Only patches if there's something NEW to mark as read (saves writes)
 */
export const markAsRead = mutation({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);

    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      return { success: false };
    }

    // Get participant record
    const participant = await ctx.db
      .query("conversation_participants")
      .withIndex("by_conversation_and_profile", (q) => 
        q.eq("conversationId", args.conversationId).eq("profileId", profile._id)
      )
      .first();

    if (!participant || participant.isActive === false) {
      return { success: false };
    }

    // Only update if there's something NEW to mark as read
    if (
      conversation.lastMessageAt != null &&
      (participant.lastReadMessageAt ?? 0) < conversation.lastMessageAt
    ) {
      await ctx.db.patch(participant._id, {
        lastReadMessageAt: conversation.lastMessageAt,
      });
    }

    return { success: true };
  },
});

/**
 * Delete a message (only sender can delete)
 */
export const remove = mutation({
  args: {
    messageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    const profile = await requireAuth(ctx);
    
    // Rate limit: 10 deletes per minute
    await checkRateLimit(ctx, "deleteAction", profile._id);

    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    if (message.senderId !== profile._id) {
      throw new Error("You can only delete your own messages");
    }

    const conversationId = message.conversationId;
    await ctx.db.patch(args.messageId, {
      deletedAt: Date.now(),
      text: undefined,
      audioUrl: undefined,
      audioObjectKey: undefined,
    });

    const conversation = await ctx.db.get(conversationId);
    if (conversation && conversation.lastMessageId === args.messageId) {
      const latestRemainingMessage = await ctx.db
        .query("messages")
        .withIndex("by_conversation_time", (q) =>
          q.eq("conversationId", conversationId)
        )
        .order("desc")
        .filter((q) => q.eq(q.field("deletedAt"), undefined))
        .first();

      if (latestRemainingMessage) {
        await ctx.db.patch(conversationId, {
          lastMessageAt: latestRemainingMessage._creationTime,
          lastMessageId: latestRemainingMessage._id,
          lastMessageSenderId: latestRemainingMessage.senderId,
          lastMessageText: latestRemainingMessage.text,
          lastMessageAudioUrl: latestRemainingMessage.audioUrl,
          lastMessageAudioObjectKey: latestRemainingMessage.audioObjectKey,
          lastMessageCreatedAt: latestRemainingMessage._creationTime,
        });
      } else {
        await ctx.db.patch(conversationId, {
          lastMessageAt: undefined,
          lastMessageId: undefined,
          lastMessageSenderId: undefined,
          lastMessageText: undefined,
          lastMessageAudioUrl: undefined,
          lastMessageAudioObjectKey: undefined,
          lastMessageCreatedAt: undefined,
        });
      }
    }

    return { message: "Message deleted successfully" };
  },
});
