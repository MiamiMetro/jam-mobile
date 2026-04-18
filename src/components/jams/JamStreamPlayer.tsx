import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  roomName: string;
  streamUrl?: string | null;
};

const DEFAULT_VOLUME = 0.8;
const VOLUME_STEPS = [0.2, 0.4, 0.6, 0.8, 1];

export default function JamStreamPlayer({ roomName, streamUrl }: Props) {
  const player = useAudioPlayer(null, {
    keepAudioSessionActive: true,
    preferredForwardBufferDuration: 8,
    updateInterval: 250,
  });
  const status = useAudioPlayerStatus(player);
  const [error, setError] = React.useState<string | null>(null);
  const [hasLoadedSource, setHasLoadedSource] = React.useState(false);
  const [hasRequestedPlayback, setHasRequestedPlayback] = React.useState(false);
  const [volume, setVolumeState] = React.useState(DEFAULT_VOLUME);
  const previousVolumeRef = React.useRef(DEFAULT_VOLUME);

  const isPreparing =
    hasRequestedPlayback &&
    !status.playing &&
    (!status.isLoaded || status.isBuffering || status.timeControlStatus === "waiting");
  const statusLabel = error
    ? "Needs retry"
    : status.playing
      ? "LIVE"
      : isPreparing
        ? "Connecting"
        : hasLoadedSource || status.isLoaded
          ? "Ready"
          : "Offline";

  React.useEffect(() => {
    player.pause();
    try {
      player.remove();
    } catch {
      // The hook releases the player on unmount; remove is best-effort cleanup.
    }
    setError(null);
    setHasLoadedSource(false);
    setHasRequestedPlayback(false);
  }, [player, streamUrl]);

  React.useEffect(() => {
    if (!hasRequestedPlayback || status.playbackState !== "failed") return;
    setHasRequestedPlayback(false);
    setError("Stream could not be loaded.");
  }, [hasRequestedPlayback, status.playbackState]);

  const setVolume = React.useCallback(
    (nextVolume: number) => {
      const clamped = Math.max(0, Math.min(1, nextVolume));
      if (clamped > 0) {
        previousVolumeRef.current = clamped;
      }
      setVolumeState(clamped);
      player.volume = clamped;
      player.muted = clamped === 0;
    },
    [player]
  );

  const toggleMute = () => {
    if (volume > 0) {
      setVolume(0);
      return;
    }
    setVolume(previousVolumeRef.current || DEFAULT_VOLUME);
  };

  const startPlayback = async (forceReload = false) => {
    if (!streamUrl) return;

    try {
      setError(null);
      setHasRequestedPlayback(true);

      if (forceReload || !hasLoadedSource) {
        if (forceReload) {
          player.pause();
          try {
            player.remove();
          } catch {
            // See cleanup comment above.
          }
        }
        player.replace({
          name: `${roomName} live stream`,
          uri: streamUrl,
        });
        setHasLoadedSource(true);
      }

      player.volume = volume;
      player.muted = volume === 0;
      player.play();
    } catch {
      setHasRequestedPlayback(false);
      setError("Stream could not be played.");
    }
  };

  const togglePlayback = () => {
    if (!streamUrl) return;

    if (status.playing) {
      player.pause();
      setHasRequestedPlayback(false);
      return;
    }

    startPlayback();
  };

  if (!streamUrl) {
    return (
      <View style={styles.container}>
        <View style={styles.waitingVisualizer}>
          <View style={[styles.waitingBar, styles.waitingBarShort]} />
          <View style={styles.waitingBar} />
          <View style={[styles.waitingBar, styles.waitingBarTall]} />
          <View style={styles.waitingBar} />
          <View style={[styles.waitingBar, styles.waitingBarShort]} />
        </View>
        <Text style={styles.waitingTitle}>Waiting for the jam to start</Text>
        <Text style={styles.waitingBody}>
          The stream will appear when the host starts performing.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <Pressable
          accessibilityLabel={status.playing ? "Pause jam stream" : "Play jam stream"}
          disabled={isPreparing}
          onPress={togglePlayback}
          style={({ pressed }) => [
            styles.playButton,
            pressed ? styles.playButtonPressed : null,
            isPreparing ? styles.playButtonDisabled : null,
          ]}
        >
          {isPreparing ? (
            <ActivityIndicator color="#251B0A" size="small" />
          ) : (
            <Ionicons
              color="#251B0A"
              name={status.playing ? "pause" : "play"}
              size={22}
            />
          )}
        </Pressable>

        <View style={styles.meta}>
          <View style={styles.titleLine}>
            <Text numberOfLines={1} style={styles.title}>
              Live Session
            </Text>
            <View style={[styles.statusBadge, status.playing ? styles.statusBadgeLive : null]}>
              <View style={[styles.statusDot, status.playing ? styles.statusDotLive : null]} />
              <Text style={[styles.statusText, status.playing ? styles.statusTextLive : null]}>
                {statusLabel}
              </Text>
            </View>
          </View>
          <Text numberOfLines={1} style={styles.subtitle}>
            {status.playing ? "Listening at the live edge" : "Listener mode"}
          </Text>
        </View>
      </View>

      <View style={styles.liveTrack}>
        <View style={[styles.liveFill, status.playing ? styles.liveFillOn : null]} />
      </View>

      <View style={styles.controlsRow}>
        <Pressable
          accessibilityLabel={volume > 0 ? "Mute stream" : "Unmute stream"}
          onPress={toggleMute}
          style={styles.iconButton}
        >
          <Ionicons
            color="#AEB6C4"
            name={volume > 0 ? "volume-high-outline" : "volume-mute-outline"}
            size={18}
          />
        </Pressable>

        <View style={styles.volumeSteps}>
          {VOLUME_STEPS.map((step) => (
            <Pressable
              accessibilityLabel={`Set volume to ${Math.round(step * 100)} percent`}
              key={step}
              onPress={() => setVolume(step)}
              style={[
                styles.volumeStep,
                volume >= step ? styles.volumeStepActive : null,
              ]}
            />
          ))}
        </View>

        {error ? (
          <Pressable onPress={() => startPlayback(true)} style={styles.retryButton}>
            <Ionicons color="#D8A64A" name="refresh" size={14} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#222733",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    borderWidth: 1,
    gap: 13,
    padding: 14,
  },
  topRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  playButton: {
    alignItems: "center",
    backgroundColor: "#D8A64A",
    borderRadius: 8,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  playButtonPressed: {
    backgroundColor: "#C89434",
  },
  playButtonDisabled: {
    opacity: 0.72,
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  titleLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  title: {
    color: "#EEF0F5",
    flex: 1,
    fontSize: 16,
    fontWeight: "900",
  },
  subtitle: {
    color: "#8F98A8",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
  statusBadge: {
    alignItems: "center",
    backgroundColor: "#303644",
    borderRadius: 8,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  statusBadgeLive: {
    backgroundColor: "rgba(239,68,68,0.13)",
  },
  statusDot: {
    backgroundColor: "#737D8C",
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  statusDotLive: {
    backgroundColor: "#EF4444",
  },
  statusText: {
    color: "#AEB6C4",
    fontSize: 11,
    fontWeight: "900",
  },
  statusTextLive: {
    color: "#FCA5A5",
  },
  liveTrack: {
    backgroundColor: "#303644",
    borderRadius: 8,
    height: 7,
    overflow: "hidden",
  },
  liveFill: {
    backgroundColor: "rgba(216,166,74,0.34)",
    height: "100%",
    width: "0%",
  },
  liveFillOn: {
    width: "100%",
  },
  controlsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  volumeSteps: {
    alignItems: "flex-end",
    flex: 1,
    flexDirection: "row",
    gap: 5,
    minHeight: 24,
  },
  volumeStep: {
    backgroundColor: "#303644",
    borderRadius: 3,
    flex: 1,
    height: 7,
  },
  volumeStepActive: {
    backgroundColor: "#D8A64A",
  },
  retryButton: {
    alignItems: "center",
    borderColor: "rgba(216,166,74,0.28)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  retryText: {
    color: "#D8A64A",
    fontSize: 12,
    fontWeight: "900",
  },
  error: {
    color: "#FCA5A5",
    fontSize: 12,
    fontWeight: "700",
  },
  waitingVisualizer: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 5,
    height: 34,
    justifyContent: "center",
  },
  waitingBar: {
    backgroundColor: "rgba(216,166,74,0.24)",
    borderRadius: 3,
    height: 22,
    width: 6,
  },
  waitingBarShort: {
    height: 14,
  },
  waitingBarTall: {
    height: 30,
  },
  waitingTitle: {
    color: "#EEF0F5",
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  waitingBody: {
    color: "#8F98A8",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
    textAlign: "center",
  },
});
