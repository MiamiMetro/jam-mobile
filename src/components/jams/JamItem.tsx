import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { RoomFeedItem } from "@/types";

type Props = {
  onPress?: () => void;
  room: RoomFeedItem;
};

export default function JamItem({ onPress, room }: Props) {
  const hostName = room.host?.username ?? room.handle;
  const hostAvatar = room.host?.avatar_url ?? "";
  const initials = hostName.slice(0, 2).toUpperCase();
  const isLive = room.status === "live" || room.participant_count > 0;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        isLive ? styles.cardLive : null,
        pressed ? styles.cardPressed : null,
      ]}
    >
      <View style={styles.topLine}>
        <View style={styles.roomIcon}>
          <Ionicons color="#D8A64A" name="musical-notes" size={18} />
        </View>

        <View style={styles.titleBlock}>
          <View style={styles.titleRow}>
            <Text numberOfLines={1} style={styles.title}>
              {room.name}
            </Text>
            {room.is_private ? (
              <Ionicons color="#8F98A8" name="lock-closed-outline" size={14} />
            ) : null}
          </View>
          <Text numberOfLines={1} style={styles.handle}>
            jam/{room.handle}
          </Text>
        </View>

        <View style={[styles.liveBadge, isLive ? styles.liveBadgeOn : null]}>
          <View style={[styles.liveDot, isLive ? styles.liveDotOn : null]} />
          <Text style={[styles.liveText, isLive ? styles.liveTextOn : null]}>
            {isLive ? "Live" : "Idle"}
          </Text>
        </View>
      </View>

      {room.description ? (
        <Text numberOfLines={2} style={styles.description}>
          {room.description}
        </Text>
      ) : null}

      <View style={styles.metaGrid}>
        <MetaItem icon="people-outline" label={`${room.participant_count} listeners`} />
        <MetaItem icon="person-add-outline" label={`${room.max_performers} performers`} />
        <MetaItem icon="time-outline" label={formatRelativeTime(room.last_active_at)} />
        {room.stream_url ? <MetaItem icon="radio-outline" label="Stream ready" /> : null}
      </View>

      <View style={styles.footer}>
        <View style={styles.hostAvatar}>
          {hostAvatar ? (
            <Image source={{ uri: hostAvatar }} style={styles.hostAvatarImage} />
          ) : (
            <Text style={styles.hostAvatarText}>{initials}</Text>
          )}
        </View>
        <View style={styles.hostTextBlock}>
          <Text numberOfLines={1} style={styles.hostName}>
            @{hostName}
          </Text>
          <Text numberOfLines={1} style={styles.hostLabel}>
            Host
          </Text>
        </View>
        {room.genre ? (
          <View style={styles.genrePill}>
            <Text numberOfLines={1} style={styles.genreText}>
              {room.genre}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function MetaItem({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View style={styles.metaItem}>
      <Ionicons color="#8F98A8" name={icon} size={13} />
      <Text numberOfLines={1} style={styles.metaText}>
        {label}
      </Text>
    </View>
  );
}

function formatRelativeTime(value: string) {
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return "recently";

  const diffSeconds = Math.max(0, Math.floor((Date.now() - date) / 1000));
  if (diffSeconds < 60) return "active now";

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(value).toLocaleDateString();
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#222733",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    marginHorizontal: 14,
    marginBottom: 10,
    padding: 14,
  },
  cardLive: {
    borderColor: "rgba(216,166,74,0.26)",
  },
  cardPressed: {
    backgroundColor: "#262C39",
  },
  topLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  roomIcon: {
    alignItems: "center",
    backgroundColor: "rgba(216,166,74,0.12)",
    borderRadius: 8,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  title: {
    color: "#EEF0F5",
    flex: 1,
    fontSize: 16,
    fontWeight: "900",
  },
  handle: {
    color: "#8F98A8",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 3,
  },
  liveBadge: {
    alignItems: "center",
    backgroundColor: "#303644",
    borderRadius: 8,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  liveBadgeOn: {
    backgroundColor: "rgba(34,197,94,0.12)",
  },
  liveDot: {
    backgroundColor: "#737D8C",
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  liveDotOn: {
    backgroundColor: "#22C55E",
  },
  liveText: {
    color: "#AEB6C4",
    fontSize: 11,
    fontWeight: "900",
  },
  liveTextOn: {
    color: "#86EFAC",
  },
  description: {
    color: "#C7CCD6",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
  metaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaItem: {
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
  metaText: {
    color: "#AEB6C4",
    fontSize: 11,
    fontWeight: "800",
  },
  footer: {
    alignItems: "center",
    borderTopColor: "rgba(255,255,255,0.07)",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 9,
    paddingTop: 11,
  },
  hostAvatar: {
    alignItems: "center",
    backgroundColor: "#303644",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    overflow: "hidden",
    width: 32,
  },
  hostAvatarImage: {
    height: 32,
    width: 32,
  },
  hostAvatarText: {
    color: "#C7CCD6",
    fontSize: 11,
    fontWeight: "900",
  },
  hostTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  hostName: {
    color: "#EEF0F5",
    fontSize: 13,
    fontWeight: "900",
  },
  hostLabel: {
    color: "#8F98A8",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  genrePill: {
    backgroundColor: "rgba(216,166,74,0.12)",
    borderColor: "rgba(216,166,74,0.22)",
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 120,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  genreText: {
    color: "#D8A64A",
    fontSize: 11,
    fontWeight: "900",
  },
});
