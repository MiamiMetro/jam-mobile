import { useState } from "react";
import {
  FileSystemUploadType,
  getInfoAsync,
  uploadAsync,
} from "expo-file-system/legacy";
import { authClient } from "@/lib/auth-client";

export type MediaUploadKind = "avatar" | "banner" | "audio";

type UploadFileInput = {
  contentType?: string | null;
  kind: MediaUploadKind;
  name: string;
  size?: number | null;
  uri: string;
};

export function useMediaUpload() {
  const [isUploading, setIsUploading] = useState(false);

  const uploadFile = async (input: UploadFileInput) => {
    setIsUploading(true);

    try {
      const baseUrl = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
      if (!baseUrl) {
        throw new Error("UPLOAD_CONFIG_MISSING: EXPO_PUBLIC_CONVEX_SITE_URL is not configured");
      }

      const tokenResult = await authClient.convex.token();
      const token = tokenResult?.data?.token;
      if (!token) {
        throw new Error("NOT_AUTHENTICATED: Missing auth token");
      }

      const contentType = input.contentType || guessContentType(input.name, input.kind);
      const fileSize = input.size ?? (await getFileSize(input.uri));

      const initResponse = await fetch(`${baseUrl.replace(/\/+$/, "")}/media/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          kind: input.kind,
          filename: input.name,
          contentType,
          fileSize,
        }),
      });

      const uploadData = (await initResponse.json().catch(() => null)) as
        | {
            error?: string;
            details?: string;
            headers?: Record<string, string>;
            key?: string;
            method?: "PUT";
            publicUrl?: string;
            uploadSessionId?: string;
            uploadUrl?: string;
          }
        | null;

      if (!initResponse.ok) {
        const details =
          uploadData?.details ||
          uploadData?.error ||
          `Upload failed with status ${initResponse.status}`;
        throw new Error(`UPLOAD_FAILED: ${details}`);
      }

      if (
        !uploadData?.uploadSessionId ||
        !uploadData.uploadUrl ||
        !uploadData.publicUrl ||
        !uploadData.key
      ) {
        throw new Error("UPLOAD_FAILED: Invalid upload response");
      }

      const uploadResponse = await uploadAsync(uploadData.uploadUrl, input.uri, {
        headers: uploadData.headers ?? {
          "Content-Type": contentType,
        },
        httpMethod: uploadData.method ?? "PUT",
        uploadType: FileSystemUploadType.BINARY_CONTENT,
      });

      if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
        throw new Error(
          `UPLOAD_FAILED: Storage returned status ${uploadResponse.status}`
        );
      }

      const finalizeResponse = await fetch(`${baseUrl.replace(/\/+$/, "")}/media/finalize`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uploadSessionId: uploadData.uploadSessionId,
        }),
      });

      const finalized = (await finalizeResponse.json().catch(() => null)) as
        | {
            error?: string;
            details?: string;
            key?: string;
            publicUrl?: string;
          }
        | null;

      if (!finalizeResponse.ok) {
        const details =
          finalized?.details ||
          finalized?.error ||
          `Finalize failed with status ${finalizeResponse.status}`;
        throw new Error(`UPLOAD_FINALIZE_FAILED: ${details}`);
      }

      if (!finalized?.publicUrl) {
        throw new Error("UPLOAD_FINALIZE_FAILED: Invalid finalize response");
      }

      return {
        key: finalized.key,
        url: finalized.publicUrl,
      };
    } finally {
      setIsUploading(false);
    }
  };

  return {
    isUploading,
    uploadFile,
  };
}

async function getFileSize(uri: string) {
  const info = await getInfoAsync(uri);
  if (!info.exists || typeof info.size !== "number") {
    throw new Error("UPLOAD_FAILED: Could not read selected file size");
  }
  return info.size;
}

function guessContentType(filename: string, kind: MediaUploadKind) {
  if (kind !== "audio") return "application/octet-stream";

  const lower = filename.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".mp4")) return "audio/mp4";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".webm")) return "audio/webm";
  return "audio/mpeg";
}
