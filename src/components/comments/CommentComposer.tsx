import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type Props = {
  buttonLabel?: string;
  initialValue?: string;
  isSubmitting?: boolean;
  onSubmit: (text: string) => Promise<void>;
  placeholder: string;
};

const MAX_COMMENT_LENGTH = 1000;

export default function CommentComposer({
  buttonLabel = "Comment",
  initialValue = "",
  isSubmitting = false,
  onSubmit,
  placeholder,
}: Props) {
  const [text, setText] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);

  const trimmedText = text.trim();
  const canSubmit = trimmedText.length > 0 && !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    try {
      setError(null);
      await onSubmit(trimmedText);
      setText("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || "Failed to send comment.");
    }
  };

  return (
    <View style={styles.container}>
      <TextInput
        editable={!isSubmitting}
        maxLength={MAX_COMMENT_LENGTH}
        multiline
        onChangeText={(value) => {
          setText(value);
          setError(null);
        }}
        placeholder={placeholder}
        placeholderTextColor="#7E8796"
        style={styles.input}
        textAlignVertical="top"
        value={text}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <Text style={styles.counter}>
          {text.length}/{MAX_COMMENT_LENGTH}
        </Text>
        <Pressable
          disabled={!canSubmit}
          onPress={handleSubmit}
          style={({ pressed }) => [
            styles.button,
            !canSubmit ? styles.buttonDisabled : null,
            pressed && canSubmit ? styles.buttonPressed : null,
          ]}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#251B0A" />
          ) : (
            <Text style={styles.buttonText}>{buttonLabel}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#262B37",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  input: {
    backgroundColor: "#1E2330",
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 8,
    borderWidth: 1,
    color: "#EEF0F5",
    fontSize: 14,
    lineHeight: 21,
    minHeight: 62,
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
  footer: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
  },
  counter: {
    color: "#8F98A8",
    fontSize: 12,
    fontWeight: "600",
  },
  button: {
    alignItems: "center",
    backgroundColor: "#D8A64A",
    borderRadius: 8,
    minHeight: 34,
    justifyContent: "center",
    minWidth: 92,
    paddingHorizontal: 16,
  },
  buttonDisabled: {
    backgroundColor: "#4B4F5D",
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonText: {
    color: "#251B0A",
    fontSize: 13,
    fontWeight: "800",
  },
});

