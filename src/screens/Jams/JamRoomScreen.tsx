import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import JamStreamPlayer from "@/components/jams/JamStreamPlayer";
import { useJamRoomPresence } from "@/hooks/useJamRoomPresence";
import { useRoom, useRoomParticipants } from "@/hooks/useRooms";
import type { RoomParticipant } from "@/types";
import type { RootStackParamList } from "@/navigation/RootNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "JamRoom">;

export default function JamRoomScreen({ navigation, route }: Props) {
  const { handle } = route.params;
  const { room, isLoading } = useRoom(handle);
  const { participants, totalCount } = useRoomParticipants(room?.id);
  const presence = useJamRoomPresence(room?.id, Boolean(room?.is_active));
  const hostName = room?.host?.display_name || room?.host?.username || "Unknown host";

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <Header onBack={navigation.goBack} title="Jam room" />
        <View style={styles.centerState}>
          <ActivityIndicator color="#D8A64A" />
          <Text style={styles.stateText}>Room is loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!room) {
    return (
      <SafeAreaView style={styles.container}>
        <Header onBack={navigation.goBack} title="Room not found" />
        <View style={styles.centerState}>
          <Ionicons color="#4B5565" name="musical-notes-outline" size={38} />
          <Text style={styles.emptyTitle}>Room not found</Text>
          <Text style={styles.stateText}>This jam may have ended or moved.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Header
        meta={`jam/${room.handle}`}
        onBack={navigation.goBack}
        title={room.name}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroTopLine}>
            <View style={styles.hostIdentity}>
              <Avatar
                image={room.host?.avatar_url}
                label={room.host?.username ?? room.handle}
                size={48}
              />
              <View style={styles.hostText}>
                <Text numberOfLines={1} style={styles.hostName}>
                  {hostName}
                </Text>
                <Text numberOfLines={1} style={styles.hostSubtext}>
                  Listener mode
                </Text>
              </View>
            </View>

            <View style={[styles.liveBadge, room.status === "live" ? styles.liveBadgeOn : null]}>
              <View style={[styles.liveDot, room.status === "live" ? styles.liveDotOn : null]} />
              <Text style={[styles.liveText, room.status === "live" ? styles.liveTextOn : null]}>
                {room.status === "live" ? "Live" : "Idle"}
              </Text>
            </View>
          </View>

          {room.description ? (
            <Text style={styles.description}>{room.description}</Text>
          ) : null}

          <View style={styles.detailRow}>
            <DetailPill icon="people-outline" label={`${totalCount} listeners`} />
            <DetailPill icon="person-add-outline" label={`${room.max_performers} performers`} />
            {room.genre ? <DetailPill label={room.genre} /> : null}
            {room.is_private ? <DetailPill icon="lock-closed-outline" label="Private" /> : null}
          </View>

          {presence.error ? (
            <View style={styles.warningBox}>
              <Ionicons color="#FCA5A5" name="alert-circle-outline" size={16} />
              <Text style={styles.warningText}>{presence.error}</Text>
            </View>
          ) : (
            <View style={styles.presenceLine}>
              <View style={[styles.presenceDot, presence.isConnected ? styles.presenceDotOn : null]} />
              <Text style={styles.presenceText}>
                {presence.isConnected ? "Joined as listener" : "Joining listener presence..."}
              </Text>
            </View>
          )}
        </View>

        <JamStreamPlayer roomName={room.name} streamUrl={room.stream_url} />

        <View style={styles.infoBlock}>
          <View style={styles.infoHeader}>
            <Text style={styles.sectionTitle}>In This Room</Text>
            <Text style={styles.sectionMeta}>{participants.length} shown</Text>
          </View>

          {participants.length === 0 ? (
            <View style={styles.emptyParticipants}>
              <Text style={styles.emptyParticipantsText}>No listeners visible yet.</Text>
            </View>
          ) : (
            participants.map((participant) => (
              <ParticipantRow
                isHost={participant.profile_id === room.host_id}
                key={participant.profile_id}
                participant={participant}
              />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({
  meta,
  onBack,
  title,
}: {
  meta?: string;
  onBack: () => void;
  title: string;
}) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityLabel="Back to jams" onPress={onBack} style={styles.backButton}>
        <Ionicons color="#AEB6C4" name="chevron-back" size={22} />
      </Pressable>
      <View style={styles.headerText}>
        <Text numberOfLines={1} style={styles.headerTitle}>
          {title}
        </Text>
        {meta ? (
          <Text numberOfLines={1} style={styles.headerMeta}>
            {meta}
          </Text>
        ) : null}
      </View>
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

function ParticipantRow({
  isHost,
  participant,
}: {
  isHost: boolean;
  participant: RoomParticipant;
}) {
  const profile = participant.profile;
  const name = profile?.display_name || profile?.username || "Unknown";
  const username = profile?.username || "listener";

  return (
    <View style={styles.participantRow}>
      <Avatar image={profile?.avatar_url} label={username} size={38} />
      <View style={styles.participantText}>
        <View style={styles.participantNameLine}>
          <Text numberOfLines={1} style={styles.participantName}>
            {name}
          </Text>
          {isHost ? (
            <View style={styles.hostBadge}>
              <Text style={styles.hostBadgeText}>Host</Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={styles.participantRole}>
          {participant.role}
        </Text>
      </View>
    </View>
  );
}

function Avatar({
  image,
  label,
  size,
}: {
  image?: string | null;
  label: string;
  size: number;
}) {
  const radius = size / 2;

  return (
    <View
      style={[
        styles.avatar,
        {
          borderRadius: radius,
          height: size,
          width: size,
        },
      ]}
    >
      {image ? (
        <Image
          source={{ uri: image }}
          style={{
            borderRadius: radius,
            height: size,
            width: size,
          }}
        />
      ) : (
        <Text style={styles.avatarText}>{label.slice(0, 2).toUpperCase()}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#1A1E29",
    flex: 1,
  },
  header: {
    alignItems: "center",
    borderBottomColor: "rgba(255,255,255,0.08)",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  backButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    color: "#EEF0F5",
    fontSize: 16,
    fontWeight: "900",
  },
  headerMeta: {
    color: "#8F98A8",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  content: {
    gap: 12,
    padding: 14,
    paddingBottom: 24,
  },
  centerState: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: "#EEF0F5",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 12,
    textAlign: "center",
  },
  stateText: {
    color: "#8F98A8",
    marginTop: 8,
    textAlign: "center",
  },
  hero: {
    backgroundColor: "#222733",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  heroTopLine: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  hostIdentity: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 10,
    minWidth: 0,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: "#303644",
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarText: {
    color: "#C7CCD6",
    fontSize: 12,
    fontWeight: "900",
  },
  hostText: {
    flex: 1,
    minWidth: 0,
  },
  hostName: {
    color: "#EEF0F5",
    fontSize: 16,
    fontWeight: "900",
  },
  hostSubtext: {
    color: "#8F98A8",
    fontSize: 12,
    fontWeight: "700",
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
    backgroundColor: "rgba(239,68,68,0.13)",
  },
  liveDot: {
    backgroundColor: "#737D8C",
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  liveDotOn: {
    backgroundColor: "#EF4444",
  },
  liveText: {
    color: "#AEB6C4",
    fontSize: 11,
    fontWeight: "900",
  },
  liveTextOn: {
    color: "#FCA5A5",
  },
  description: {
    color: "#C7CCD6",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
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
  warningBox: {
    alignItems: "center",
    backgroundColor: "rgba(127,29,29,0.32)",
    borderColor: "rgba(248,113,113,0.28)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  warningText: {
    color: "#FCA5A5",
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
  },
  presenceLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
  },
  presenceDot: {
    backgroundColor: "#737D8C",
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  presenceDotOn: {
    backgroundColor: "#22C55E",
  },
  presenceText: {
    color: "#8F98A8",
    fontSize: 12,
    fontWeight: "800",
  },
  infoBlock: {
    backgroundColor: "#222733",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  infoHeader: {
    alignItems: "center",
    borderBottomColor: "rgba(255,255,255,0.07)",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  sectionTitle: {
    color: "#EEF0F5",
    fontSize: 14,
    fontWeight: "900",
  },
  sectionMeta: {
    color: "#8F98A8",
    fontSize: 11,
    fontWeight: "800",
  },
  emptyParticipants: {
    paddingHorizontal: 14,
    paddingVertical: 18,
  },
  emptyParticipantsText: {
    color: "#8F98A8",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  participantRow: {
    alignItems: "center",
    borderBottomColor: "rgba(255,255,255,0.06)",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  participantText: {
    flex: 1,
    minWidth: 0,
  },
  participantNameLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
  },
  participantName: {
    color: "#EEF0F5",
    flex: 1,
    fontSize: 14,
    fontWeight: "900",
  },
  participantRole: {
    color: "#8F98A8",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
    textTransform: "capitalize",
  },
  hostBadge: {
    backgroundColor: "rgba(216,166,74,0.12)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  hostBadgeText: {
    color: "#D8A64A",
    fontSize: 10,
    fontWeight: "900",
  },
});
