declare const process: {
  env: Record<string, string | undefined>;
};

function getMediaPublicBaseUrl(): string | undefined {
  const value = process.env.MEDIA_PUBLIC_BASE_URL;
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, "");
}

export function normalizeMediaObjectKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const normalized = trimmed.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) return undefined;
  if (normalized.includes("://")) {
    throw new Error("MEDIA_OBJECT_KEY_INVALID: object key must not be a URL");
  }
  if (normalized.includes("?") || normalized.includes("#")) {
    throw new Error("MEDIA_OBJECT_KEY_INVALID: object key must not include query/hash");
  }

  return normalized;
}

function decodeUrlPath(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

function encodeUrlPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function buildManagedMediaUrl(objectKey: string | undefined): string | undefined {
  const baseUrl = getMediaPublicBaseUrl();
  const normalizedKey = normalizeMediaObjectKey(objectKey);
  if (!baseUrl || !normalizedKey) return undefined;
  return `${baseUrl}/${encodeUrlPath(normalizedKey)}`;
}

export function extractManagedMediaObjectKeyFromUrl(
  mediaUrl: string | undefined
): string | undefined {
  const url = mediaUrl?.trim();
  if (!url) return undefined;

  const baseUrl = getMediaPublicBaseUrl();
  if (!baseUrl) return undefined;

  try {
    const parsedMedia = new URL(url);
    const parsedBase = new URL(baseUrl);
    if (parsedMedia.origin !== parsedBase.origin) return undefined;

    const basePath = parsedBase.pathname.replace(/\/+$/, "");
    const mediaPath = parsedMedia.pathname;
    const prefix = basePath ? `${basePath}/` : "/";
    if (basePath && !mediaPath.startsWith(prefix) && mediaPath !== basePath) {
      return undefined;
    }

    const relative = mediaPath.slice(basePath.length).replace(/^\/+/, "");
    if (!relative) return undefined;
    return normalizeMediaObjectKey(decodeUrlPath(relative));
  } catch {
    return undefined;
  }
}

export function resolvePublicMediaUrl(params: {
  url: string | undefined;
  objectKey: string | undefined;
}): string {
  const normalizedObjectKey = normalizeMediaObjectKey(params.objectKey);
  if (normalizedObjectKey) {
    const managedUrl = buildManagedMediaUrl(normalizedObjectKey);
    if (managedUrl) return managedUrl;
  }
  return params.url?.trim() ?? "";
}
