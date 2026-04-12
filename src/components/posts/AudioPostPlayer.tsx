import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import {
  cacheDirectory,
  downloadAsync,
} from "expo-file-system/legacy";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  GestureResponderEvent,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";

type Props = {
  audioUrl: string;
  duration?: number | null;
  style?: StyleProp<ViewStyle>;
  title?: string | null;
};

const AUDIO_DOWNLOAD_TIMEOUT_MS = 15000;

export default function AudioPostPlayer({
  audioUrl,
  duration,
  style,
  title,
}: Props) {
  const player = useAudioPlayer(null, {
    keepAudioSessionActive: true,
    updateInterval: 250,
  });
  const status = useAudioPlayerStatus(player);
  const unsupportedReason = getUnsupportedAudioReason(audioUrl);
  const [progressWidth, setProgressWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hasRequestedPlayback, setHasRequestedPlayback] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadedUri, setDownloadedUri] = useState<string | null>(null);

  const displayDuration = status.duration > 0 ? status.duration : duration ?? 0;
  const currentTime = displayDuration
    ? Math.min(status.currentTime, displayDuration)
    : status.currentTime;
  const progress = displayDuration > 0 ? currentTime / displayDuration : 0;
  const isPreparingPlayback =
    hasRequestedPlayback &&
    !status.playing &&
    (isDownloading || !status.isLoaded || status.isBuffering);

  useEffect(() => {
    player.pause();
    setDownloadedUri(null);
    setError(null);
    setHasRequestedPlayback(false);
    setIsDownloading(false);
  }, [audioUrl, player]);

  useEffect(() => {
    if (status.didJustFinish) {
      setHasRequestedPlayback(false);
    }
  }, [status.didJustFinish]);

  useEffect(() => {
    if (!hasRequestedPlayback || status.playbackState !== "failed") return;

    setHasRequestedPlayback(false);
    setIsDownloading(false);
    setError("Audio could not be loaded.");
  }, [hasRequestedPlayback, status.playbackState]);

  useEffect(() => {
    if (
      !downloadedUri ||
      !hasRequestedPlayback ||
      isDownloading ||
      status.didJustFinish ||
      status.playing ||
      !status.isLoaded
    ) {
      return;
    }

    try {
      player.play();
    } catch {
      setHasRequestedPlayback(false);
      setError("Audio could not be played.");
    }
  }, [
    downloadedUri,
    hasRequestedPlayback,
    isDownloading,
    player,
    status.didJustFinish,
    status.isLoaded,
    status.playing,
  ]);

  const handleTogglePlayback = async () => {
    if (unsupportedReason) return;

    try {
      setError(null);

      if (status.playing) {
        player.pause();
        setHasRequestedPlayback(false);
        return;
      }

      setHasRequestedPlayback(true);

      let playableUri = downloadedUri;
      if (!playableUri) {
        setIsDownloading(true);
        playableUri = await downloadAudioToCache(audioUrl, title);
        setDownloadedUri(playableUri);
        player.replace({
          name: title ?? "Audio post",
          uri: playableUri,
        });
      }

      if (
        displayDuration > 0 &&
        status.currentTime >= Math.max(0, displayDuration - 0.25)
      ) {
        await player.seekTo(0);
      }
      player.volume = 1;
      player.muted = false;
      player.play();
    } catch {
      setHasRequestedPlayback(false);
      setError("Audio could not be played.");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleProgressLayout = (event: LayoutChangeEvent) => {
    setProgressWidth(event.nativeEvent.layout.width);
  };

  const handleSeek = async (event: GestureResponderEvent) => {
    if (!displayDuration || progressWidth <= 0) return;

    try {
      setError(null);
      const ratio = clamp(event.nativeEvent.locationX / progressWidth, 0, 1);
      await player.seekTo(ratio * displayDuration);
    } catch {
      setError("Could not seek audio.");
    }
  };

  return (
    <View style={[styles.container, style]}>
      <View style={styles.topRow}>
        <Pressable
          accessibilityLabel={status.playing ? "Pause audio" : "Play audio"}
          disabled={!!unsupportedReason}
          onPress={handleTogglePlayback}
          style={({ pressed }) => [
            styles.playButton,
            unsupportedReason ? styles.playButtonDisabled : null,
            pressed ? styles.playButtonPressed : null,
          ]}
        >
          {unsupportedReason ? (
            <Ionicons color="#8F98A8" name="alert" size={18} />
          ) : isPreparingPlayback ? (
            <ActivityIndicator color="#251B0A" size="small" />
          ) : (
            <Ionicons
              color="#251B0A"
              name={status.playing ? "pause" : "play"}
              size={18}
            />
          )}
        </Pressable>

        <View style={styles.meta}>
          <Text numberOfLines={1} style={styles.title}>
            {title ?? "Audio post"}
          </Text>
          <Text style={styles.time}>
            {formatDuration(currentTime)} / {formatDuration(displayDuration)}
          </Text>
        </View>
      </View>

      <Pressable
        disabled={!displayDuration}
        onLayout={handleProgressLayout}
        onPress={handleSeek}
        style={styles.progressTrack}
      >
        <View style={[styles.progressFill, { width: `${clamp(progress, 0, 1) * 100}%` }]} />
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {unsupportedReason ? (
        <Text style={styles.unsupported}>{unsupportedReason}</Text>
      ) : null}
    </View>
  );
}

function formatDuration(seconds: number) {
  if (!seconds || Number.isNaN(seconds)) return "0:00";

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function downloadAudioToCache(audioUrl: string, title?: string | null) {
  if (!cacheDirectory) {
    throw new Error("Audio cache is unavailable.");
  }

  const fileUri = `${cacheDirectory}jam-audio-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}${getAudioExtension(audioUrl, title)}`;
  const result = await withTimeout(
    downloadAsync(audioUrl, fileUri),
    AUDIO_DOWNLOAD_TIMEOUT_MS,
    "Audio download timed out."
  );

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Audio download failed with status ${result.status}`);
  }

  return result.uri;
}

function getAudioExtension(audioUrl: string, title?: string | null) {
  const extension =
    getExtensionFromPath(audioUrl) ?? getExtensionFromPath(title ?? "");

  if (!extension) return ".mp3";
  return extension;
}

function getExtensionFromPath(value: string) {
  const path = getPathname(value);
  const match = path.match(/\.(mp3|m4a|mp4|aac|wav|ogg|webm)$/i);
  return match ? `.${match[1].toLowerCase()}` : null;
}

function getUnsupportedAudioReason(audioUrl: string) {
  if (Platform.OS !== "ios") return null;

  const extension = getExtensionFromPath(audioUrl);
  if (extension === ".webm" || extension === ".ogg") {
    return "This audio was recorded as WebM/Opus, which iOS cannot play yet.";
  }

  return null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function getPathname(value: string) {
  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#262B37",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  topRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  playButton: {
    alignItems: "center",
    backgroundColor: "#D8A64A",
    borderRadius: 8,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  playButtonPressed: {
    backgroundColor: "#C89434",
  },
  playButtonDisabled: {
    backgroundColor: "#353B49",
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: "#EEF0F5",
    fontSize: 13,
    fontWeight: "800",
  },
  time: {
    color: "#8F98A8",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  progressTrack: {
    backgroundColor: "rgba(255,255,255,0.09)",
    borderRadius: 6,
    height: 7,
    marginTop: 12,
    overflow: "hidden",
  },
  progressFill: {
    backgroundColor: "#D8A64A",
    height: "100%",
  },
  error: {
    color: "#F87171",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 8,
  },
  unsupported: {
    color: "#D8A64A",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginTop: 8,
  },
});
