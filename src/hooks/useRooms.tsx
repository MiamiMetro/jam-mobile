import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export function useRooms(search?: string) {
  const trimmedSearch = search?.trim();
  const { results, status, loadMore } = usePaginatedQuery(
    api.rooms.listActivePaginated,
    trimmedSearch ? { search: trimmedSearch } : {},
    { initialNumItems: 10 }
  );

  return {
    rooms: results,
    isLoading: status === "LoadingFirstPage",
    isLoadingMore: status === "LoadingMore",
    canLoadMore: status === "CanLoadMore",
    loadMore,
  };
}

export function useRoom(handle: string | undefined) {
  const room = useQuery(api.rooms.getByHandle, handle ? { handle } : "skip");

  return {
    room: room ?? null,
    isLoading: room === undefined && !!handle,
  };
}

export function useMyRoom() {
  const room = useQuery(api.rooms.getMyRoom, {});

  return {
    room: room ?? null,
    isLoading: room === undefined,
  };
}

export function useFriendsInRooms() {
  const friendsInRooms = useQuery(api.rooms.getFriendsInRooms, {});

  return {
    friendsInRooms: friendsInRooms ?? [],
    isLoading: friendsInRooms === undefined,
  };
}

export function useRoomParticipants(roomId: string | undefined) {
  const data = useQuery(
    api.rooms.getParticipants,
    roomId ? { roomId: roomId as Id<"rooms"> } : "skip"
  );

  return {
    participants: data?.participants ?? [],
    totalCount: data?.total_count ?? 0,
    isLoading: data === undefined && !!roomId,
  };
}

export function useRoomHeartbeat() {
  return useMutation(api.presence.roomHeartbeat);
}

export function useDisconnectPresence() {
  return useMutation(api.presence.disconnect);
}
