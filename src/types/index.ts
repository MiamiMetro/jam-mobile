// Types automatically inferred from Convex query return types
// This ensures Convex schema is the single source of truth

import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";

// Infer User type from profile queries (Convex format - single source of truth)
type ProfileQueryReturn = FunctionReturnType<typeof api.profiles.getMe>;
export type User = NonNullable<ProfileQueryReturn>;

// Infer Post type from post queries (Convex format - single source of truth)
type PostQueryReturn = FunctionReturnType<typeof api.posts.getById>;
export type Post = NonNullable<PostQueryReturn>;

// Infer Post feed item type (Convex format - single source of truth)
type PostFeedReturn = FunctionReturnType<typeof api.posts.getFeedPaginated>;
export type PostFeedItem = PostFeedReturn["page"][number];

// Infer Comment type from comments query (Convex format - single source of truth)
type CommentsQueryReturn = FunctionReturnType<typeof api.comments.getByPostPaginated>;
export type Comment = CommentsQueryReturn["page"][number];

// Infer Message type from messages query (Convex format - single source of truth)
type MessagesQueryReturn = FunctionReturnType<typeof api.messages.getByConversationPaginated>;
export type Message = MessagesQueryReturn["data"][number];

// Infer Conversation type from conversations query (Convex format - single source of truth)
type ConversationsQueryReturn = FunctionReturnType<typeof api.messages.getConversationsPaginated>;
export type Conversation = ConversationsQueryReturn["page"][number];

// Infer Community type from community queries (Convex format - single source of truth)
type CommunityQueryReturn = FunctionReturnType<typeof api.communities.getByHandle>;
export type CommunityItem = NonNullable<CommunityQueryReturn>;

// Re-export Convex utility types for direct use
// Note: TypeScript may warn these are unused, but they ARE used via re-export throughout the codebase
export type { Doc, Id } from "../../convex/_generated/dataModel";

// Helper type that uses Doc and Id to ensure imports are recognized
// This is a workaround for TypeScript's unused import detection
type CoreTables = "profiles" | "posts" | "comments" | "messages" | "conversations";
export type ConvexDoc<T extends CoreTables> = Doc<T>;
export type ConvexId<T extends CoreTables> = Id<T>;
