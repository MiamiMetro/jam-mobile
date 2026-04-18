import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { FriendInRoomItem, MyRoom, RoomFeedItem } from "@/types";
import JamItem from "./JamItem";

type Props = {
  friendsInRooms?: FriendInRoomItem[];
  isLoading?: boolean;
  isLoadingMore?: boolean;
  isMyRoomLoading?: boolean;
  myRoom?: MyRoom | null;
  onEndReached?: () => void;
  onOpenRoom?: (room: RoomFeedItem) => void;
  onOpenRoomHandle?: (handle: string) => void;
  onSearchChange?: (value: string) => void;
  rooms: RoomFeedItem[];
  searchValue?: string;
};

export default function JamList({
  friendsInRooms = [],
  isLoading = false,
  isLoadingMore = false,
  isMyRoomLoading = false,
  myRoom,
  onEndReached,
  onOpenRoom,
  onOpenRoomHandle,
  onSearchChange,
  rooms,
  searchValue = "",
}: Props) {
  const hasSearch = searchValue.trim().length > 0;

  return (
    <FlatList
      contentContainerStyle={[styles.content, rooms.length === 0 ? styles.emptyContent : null]}
      data={rooms}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={
        <EmptyState
          isLoading={isLoading}
          message={
            hasSearch
              ? "Try another room name, handle, or vibe."
              : "No active jams right now."
          }
          title={hasSearch ? "No jams found" : "Quiet for the moment"}
        />
      }
      ListFooterComponent={
        isLoadingMore ? <ActivityIndicator color="#D8A64A" style={styles.footerLoader} /> : null
      }
      ListHeaderComponent={
        <View>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>Live Rooms</Text>
              <Text style={styles.title}>Jams</Text>
            </View>
            <View style={styles.liveCount}>
              <Text style={styles.liveCountNumber}>{rooms.length}</Text>
              <Text style={styles.liveCountLabel}>live</Text>
            </View>
          </View>

          <View style={styles.searchBox}>
            <Ionicons color="#8F98A8" name="search" size={17} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={onSearchChange}
              placeholder="Search jams..."
              placeholderTextColor="#7E8796"
              style={styles.searchInput}
              value={searchValue}
            />
            {searchValue ? (
              <Pressable
                accessibilityLabel="Clear jam search"
                onPress={() => onSearchChange?.("")}
                style={styles.clearSearchButton}
              >
                <Ionicons color="#8F98A8" name="close" size={17} />
              </Pressable>
            ) : null}
          </View>

          <MyRoomSummary
            isLoading={isMyRoomLoading}
            onOpenRoomHandle={onOpenRoomHandle}
            room={myRoom}
          />
          <FriendsJammingNow
            friendsInRooms={friendsInRooms}
            onOpenRoomHandle={onOpenRoomHandle}
          />

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>Live Rooms</Text>
            <Text style={styles.sectionMeta}>
              {isLoading ? "Loading" : `${rooms.length} shown`}
            </Text>
          </View>
        </View>
      }
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      renderItem={({ item }) => <JamItem onPress={() => onOpenRoom?.(item)} room={item} />}
    />
  );
}

function MyRoomSummary({
  isLoading,
  onOpenRoomHandle,
  room,
}: {
  isLoading: boolean;
  onOpenRoomHandle?: (handle: string) => void;
  room?: MyRoom | null;
}) {
  if (isLoading) {
    return (
      <View style={styles.myRoomCard}>
        <ActivityIndicator color="#D8A64A" size="small" />
        <Text style={styles.myRoomLoading}>Your room is loading...</Text>
      </View>
    );
  }

  if (!room) return null;

  const statusLabel = room.is_active ? "Active" : "Disabled";

  return (
    <Pressable
      disabled={!room.is_active}
      onPress={() => onOpenRoomHandle?.(room.handle)}
      style={({ pressed }) => [
        styles.myRoomCard,
        room.is_active ? styles.myRoomActive : null,
        pressed ? styles.myRoomPressed : null,
      ]}
    >
      <View style={styles.myRoomTopLine}>
        <View style={styles.myRoomTitleWrap}>
          <Ionicons color="#8F98A8" name="home-outline" size={15} />
          <Text style={styles.myRoomLabel}>My Room</Text>
        </View>
        <View style={[styles.statusPill, room.is_active ? styles.statusPillActive : null]}>
          <View style={[styles.statusDot, room.is_active ? styles.statusDotActive : null]} />
          <Text style={[styles.statusText, room.is_active ? styles.statusTextActive : null]}>
            {statusLabel}
          </Text>
        </View>
      </View>

      <Text numberOfLines={1} style={styles.myRoomName}>
        {room.name}
      </Text>
      {room.description ? (
        <Text numberOfLines={2} style={styles.myRoomDescription}>
          {room.description}
        </Text>
      ) : null}

      <View style={styles.detailRow}>
        <DetailPill icon="people-outline" label={`${room.participant_count} listeners`} />
        <DetailPill icon="person-add-outline" label={`${room.max_performers} performers`} />
        {room.genre ? <DetailPill label={room.genre} /> : null}
        {room.is_private ? <DetailPill icon="lock-closed-outline" label="Private" /> : null}
      </View>
    </Pressable>
  );
}

function FriendsJammingNow({
  friendsInRooms,
  onOpenRoomHandle,
}: {
  friendsInRooms: FriendInRoomItem[];
  onOpenRoomHandle?: (handle: string) => void;
}) {
  if (friendsInRooms.length === 0) return null;

  return (
    <View style={styles.friendsBlock}>
      <Text style={styles.friendsTitle}>Friends Jamming Now</Text>
      <ScrollView
        contentContainerStyle={styles.friendsContent}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {friendsInRooms.slice(0, 8).map((item) => (
          <Pressable
            key={`${item.friend.id}-${item.room_id}`}
            onPress={() => onOpenRoomHandle?.(item.room_handle)}
            style={({ pressed }) => [
              styles.friendChip,
              pressed ? styles.friendChipPressed : null,
            ]}
          >
            <View style={styles.friendAvatar}>
              <Text style={styles.friendAvatarText}>
                {item.friend.username.slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <View style={styles.friendChipTextWrap}>
              <Text numberOfLines={1} style={styles.friendName}>
                {item.friend.username}
              </Text>
              <Text numberOfLines={1} style={styles.friendRoom}>
                {item.room_name}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function DetailPill({
  icon,
  label,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View style={styles.detailPill}>
      {icon ? <Ionicons color="#8F98A8" name={icon} size={13} /> : null}
      <Text numberOfLines={1} style={styles.detailPillText}>
        {label}
      </Text>
    </View>
  );
}

function EmptyState({
  isLoading,
  message,
  title,
}: {
  isLoading: boolean;
  message: string;
  title: string;
}) {
  return (
    <View style={styles.emptyState}>
      {isLoading ? (
        <ActivityIndicator color="#D8A64A" />
      ) : (
        <Ionicons color="#4B5565" name="musical-notes-outline" size={38} />
      )}
      <Text style={styles.emptyTitle}>{isLoading ? "Loading jams..." : title}</Text>
      <Text style={styles.emptyMessage}>{isLoading ? "Finding live rooms." : message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    backgroundColor: "#1A1E29",
    paddingBottom: 18,
  },
  emptyContent: {
    flexGrow: 1,
  },
  header: {
    alignItems: "center",
    borderBottomColor: "rgba(255,255,255,0.08)",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: "#8F98A8",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  title: {
    color: "#EEF0F5",
    fontSize: 24,
    fontWeight: "900",
    marginTop: 2,
  },
  liveCount: {
    alignItems: "center",
    backgroundColor: "rgba(216,166,74,0.13)",
    borderColor: "rgba(216,166,74,0.34)",
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 58,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  liveCountNumber: {
    color: "#D8A64A",
    fontSize: 16,
    fontWeight: "900",
  },
  liveCountLabel: {
    color: "#AEB6C4",
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  searchBox: {
    alignItems: "center",
    backgroundColor: "#222733",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginHorizontal: 14,
    marginTop: 12,
    paddingLeft: 12,
    paddingRight: 6,
  },
  searchInput: {
    color: "#EEF0F5",
    flex: 1,
    fontSize: 14,
    minHeight: 42,
  },
  clearSearchButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  myRoomCard: {
    backgroundColor: "#222733",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    borderWidth: 1,
    gap: 9,
    marginHorizontal: 14,
    marginTop: 12,
    padding: 14,
  },
  myRoomActive: {
    borderColor: "rgba(216,166,74,0.34)",
  },
  myRoomPressed: {
    backgroundColor: "#262C39",
  },
  myRoomLoading: {
    color: "#8F98A8",
    fontSize: 13,
    fontWeight: "700",
  },
  myRoomTopLine: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  myRoomTitleWrap: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  myRoomLabel: {
    color: "#8F98A8",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  statusPill: {
    alignItems: "center",
    backgroundColor: "#303644",
    borderRadius: 8,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusPillActive: {
    backgroundColor: "rgba(34,197,94,0.12)",
  },
  statusDot: {
    backgroundColor: "#737D8C",
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  statusDotActive: {
    backgroundColor: "#22C55E",
  },
  statusText: {
    color: "#AEB6C4",
    fontSize: 11,
    fontWeight: "900",
  },
  statusTextActive: {
    color: "#86EFAC",
  },
  myRoomName: {
    color: "#EEF0F5",
    fontSize: 16,
    fontWeight: "900",
  },
  myRoomDescription: {
    color: "#AEB6C4",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
  },
  detailRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  detailPill: {
    alignItems: "center",
    backgroundColor: "#303644",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    maxWidth: "100%",
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  detailPillText: {
    color: "#AEB6C4",
    fontSize: 11,
    fontWeight: "800",
  },
  friendsBlock: {
    marginTop: 14,
  },
  friendsTitle: {
    color: "#8F98A8",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0,
    paddingHorizontal: 18,
    textTransform: "uppercase",
  },
  friendsContent: {
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  friendChip: {
    alignItems: "center",
    backgroundColor: "#222733",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    maxWidth: 190,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  friendChipPressed: {
    backgroundColor: "#262C39",
  },
  friendAvatar: {
    alignItems: "center",
    backgroundColor: "#303644",
    borderColor: "rgba(34,197,94,0.35)",
    borderRadius: 14,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  friendAvatarText: {
    color: "#C7CCD6",
    fontSize: 10,
    fontWeight: "900",
  },
  friendChipTextWrap: {
    minWidth: 0,
  },
  friendName: {
    color: "#EEF0F5",
    fontSize: 12,
    fontWeight: "900",
  },
  friendRoom: {
    color: "#8F98A8",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingBottom: 8,
    paddingTop: 18,
  },
  sectionLabel: {
    color: "#8F98A8",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  sectionMeta: {
    color: "#737D8C",
    fontSize: 11,
    fontWeight: "800",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 52,
  },
  emptyTitle: {
    color: "#EEF0F5",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 12,
    textAlign: "center",
  },
  emptyMessage: {
    color: "#8F98A8",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    textAlign: "center",
  },
  footerLoader: {
    marginVertical: 16,
  },
});
