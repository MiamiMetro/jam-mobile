import React, { useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation } from "convex/react";
import type { User } from "@/types";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { api } from "../../../convex/_generated/api";

type Props = {
  profile: User | null | undefined;
};

const MAX_POST_LENGTH = 1000;
const MAX_AUDIO_SIZE = 25 * 1024 * 1024;

type SelectedAudio = {
  mimeType?: string;
  name: string;
  size?: number;
  uri: string;
};

export default function ComposePost({ profile }: Props) {
  const createPost = useMutation(api.posts.create);
  const { isUploading, uploadFile } = useMediaUpload();
  const [content, setContent] = useState("");
  const [selectedAudio, setSelectedAudio] = useState<SelectedAudio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const trimmedContent = content.trim();
  const isBusy = isSubmitting || isUploading;
  const canSubmit = (trimmedContent.length > 0 || selectedAudio !== null) && !isBusy;
  const fallbackLetters = useMemo(() => {
    const source = profile?.username || profile?.display_name || "U";
    return source.slice(0, 2).toUpperCase();
  }, [profile?.display_name, profile?.username]);

  const handleSubmit = async () => {
    if (!canSubmit) return;

    try {
      setError(null);
      setIsSubmitting(true);

      let audioUrl: string | undefined;
      if (selectedAudio) {
        const uploaded = await uploadFile({
          contentType: selectedAudio.mimeType,
          kind: "audio",
          name: selectedAudio.name,
          size: selectedAudio.size,
          uri: selectedAudio.uri,
        });
        audioUrl = uploaded.url;
      }

      await createPost({
        text: trimmedContent || undefined,
        audio_url: audioUrl,
        audio_title: selectedAudio ? stripExtension(selectedAudio.name) : undefined,
      });
      setContent("");
      setSelectedAudio(null);
    } catch (err) {
      setError(getCreatePostErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePickAudio = async () => {
    if (isBusy) return;

    try {
      setError(null);
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: "audio/*",
      });

      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset) return;

      if (typeof asset.size === "number" && asset.size > MAX_AUDIO_SIZE) {
        setError("Audio must be 25MB or smaller.");
        return;
      }
      if (!isSupportedAudioFile(asset.name, asset.mimeType)) {
        setError("iOS can play MP3, M4A, MP4, AAC, or WAV audio.");
        return;
      }

      setSelectedAudio({
        mimeType: asset.mimeType,
        name: asset.name || `audio-${Date.now()}`,
        size: asset.size,
        uri: asset.uri,
      });
    } catch (err) {
      setError(getCreatePostErrorMessage(err));
    }
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.row}>
        <View style={styles.avatar}>
          {profile?.avatar_url && !avatarFailed ? (
            <Image
              onError={() => setAvatarFailed(true)}
              source={{ uri: profile.avatar_url }}
              style={styles.avatarImage}
            />
          ) : (
            <Text style={styles.avatarFallback}>{fallbackLetters}</Text>
          )}
        </View>

        <View style={styles.body}>
          <TextInput
            editable={!isSubmitting}
            maxLength={MAX_POST_LENGTH}
            multiline
            onChangeText={(value) => {
              setContent(value);
              setError(null);
            }}
            placeholder="What's on your mind? Share a message..."
            placeholderTextColor="#7E8796"
            style={styles.input}
            textAlignVertical="top"
            value={content}
          />

          {selectedAudio ? (
            <View style={styles.audioPreview}>
              <View style={styles.audioIcon}>
                <Ionicons color="#D8A64A" name="musical-note" size={16} />
              </View>
              <View style={styles.audioMeta}>
                <Text numberOfLines={1} style={styles.audioName}>
                  {selectedAudio.name}
                </Text>
                <Text style={styles.audioSize}>
                  {formatFileSize(selectedAudio.size)}
                </Text>
              </View>
              <Pressable
                disabled={isBusy}
                onPress={() => setSelectedAudio(null)}
                style={styles.removeAudioButton}
              >
                <Ionicons color="#8F98A8" name="close" size={18} />
              </Pressable>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.footer}>
            <View style={styles.footerActions}>
              <Pressable disabled={isBusy} onPress={handlePickAudio} style={styles.audioButton}>
                <Ionicons color="#8F98A8" name="cloud-upload-outline" size={16} />
                <Text style={styles.audioButtonText}>Audio</Text>
              </Pressable>
              <Text style={styles.counter}>
                {content.length}/{MAX_POST_LENGTH}
              </Text>
            </View>
            <Pressable
              disabled={!canSubmit}
              onPress={handleSubmit}
              style={({ pressed }) => [
                styles.postButton,
                !canSubmit ? styles.postButtonDisabled : null,
                pressed && canSubmit ? styles.postButtonPressed : null,
              ]}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#251B0A" />
              ) : (
                <Text style={styles.postButtonText}>{isUploading ? "Uploading..." : "Post"}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

function getCreatePostErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("NOT_AUTHENTICATED")) {
    return "Please sign in again.";
  }
  if (message.includes("PROFILE_REQUIRED")) {
    return "Create your profile before posting.";
  }
  if (message.includes("rate")) {
    return "Slow down for a moment before posting again.";
  }
  if (message.includes("INVALID_FILE_TYPE")) {
    return "Please choose an audio file.";
  }
  if (message.includes("FILE_TOO_LARGE")) {
    return "Audio must be 25MB or smaller.";
  }
  if (message.includes("UPLOAD")) {
    return message.replace(/^[A-Z_]+:\s*/, "") || "Audio upload failed.";
  }

  return message || "Failed to post. Please try again.";
}

function stripExtension(filename: string) {
  return filename.replace(/\.[^/.]+$/, "");
}

function formatFileSize(size: number | undefined) {
  if (!size) return "Audio file";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isSupportedAudioFile(filename: string, mimeType?: string) {
  if (Platform.OS !== "ios") return true;

  const lowerName = filename.toLowerCase();
  const lowerType = mimeType?.toLowerCase() ?? "";
  if (lowerName.endsWith(".webm") || lowerName.endsWith(".ogg")) return false;
  if (lowerType.includes("webm") || lowerType.includes("ogg")) return false;
  return true;
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: "#262B37",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 10,
    marginHorizontal: 14,
    marginTop: 12,
    padding: 14,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.16,
    shadowRadius: 2,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: "#353B49",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    overflow: "hidden",
    width: 44,
  },
  avatarImage: {
    height: 44,
    width: 44,
  },
  avatarFallback: {
    color: "#C7CCD6",
    fontSize: 13,
    fontWeight: "800",
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  input: {
    backgroundColor: "#1E2330",
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 8,
    borderWidth: 1,
    color: "#EEF0F5",
    fontSize: 15,
    lineHeight: 22,
    minHeight: 76,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  error: {
    backgroundColor: "rgba(127,29,29,0.5)",
    borderColor: "rgba(248,113,113,0.35)",
    borderRadius: 8,
    borderWidth: 1,
    color: "#FECACA",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  audioPreview: {
    alignItems: "center",
    backgroundColor: "#1E2330",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  audioIcon: {
    alignItems: "center",
    backgroundColor: "rgba(216,166,74,0.12)",
    borderRadius: 8,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  audioMeta: {
    flex: 1,
    minWidth: 0,
  },
  audioName: {
    color: "#D5D9E2",
    fontSize: 13,
    fontWeight: "800",
  },
  audioSize: {
    color: "#8F98A8",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  removeAudioButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  footer: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  footerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  audioButton: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 5,
    minHeight: 34,
    paddingHorizontal: 2,
  },
  audioButtonText: {
    color: "#8F98A8",
    fontSize: 12,
    fontWeight: "800",
  },
  counter: {
    color: "#8F98A8",
    fontSize: 12,
    fontWeight: "600",
  },
  postButton: {
    alignItems: "center",
    backgroundColor: "#D8A64A",
    borderRadius: 8,
    minHeight: 36,
    justifyContent: "center",
    minWidth: 78,
    paddingHorizontal: 18,
  },
  postButtonDisabled: {
    backgroundColor: "#4B4F5D",
  },
  postButtonPressed: {
    opacity: 0.82,
  },
  postButtonText: {
    color: "#251B0A",
    fontSize: 14,
    fontWeight: "800",
  },
});
