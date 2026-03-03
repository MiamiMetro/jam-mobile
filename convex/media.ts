import { httpAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { checkRateLimit } from "./rateLimiter";

declare const process: {
  env: Record<string, string | undefined>;
};

const UPLOAD_LIMITS = {
  avatar: 5 * 1024 * 1024,
  banner: 8 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
} as const;

const DEFAULT_EXTENSIONS = {
  avatar: ".jpg",
  banner: ".jpg",
  audio: ".webm",
} as const;

type UploadKind = keyof typeof UPLOAD_LIMITS;
const SIGNED_UPLOAD_TTL_SECONDS = 120;
const UPLOAD_SESSION_TTL_SECONDS = 30 * 60;

type UploadSessionDoc = {
  _id: Id<"upload_sessions">;
  ownerProfileId: Id<"profiles">;
  kind: UploadKind;
  objectKey: string;
  publicUrl: string;
  contentType: string;
  fileSize: number;
  status: "initiated" | "ready" | "consumed" | "expired";
  expiresAt: number;
};

const siteUrls = [process.env.SITE_URL, process.env.VITE_SITE_URL]
  .filter((value): value is string => !!value)
  .flatMap((value) => value.split(",").map((url) => url.trim()))
  .filter((value) => value.length > 0);

const trustedOrigins =
  siteUrls.length > 0 ? siteUrls : ["http://localhost:5173", "http://localhost:5123"];

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return toHex(hash);
}

async function hmacSha256(
  key: ArrayBuffer | Uint8Array,
  data: string
): Promise<ArrayBuffer> {
  const source = key instanceof Uint8Array ? key : new Uint8Array(key);
  const keyBytes = new Uint8Array(source.byteLength);
  keyBytes.set(source);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(data)
  );
  return signature;
}

function getTimestampFields(now: Date) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function normalizeFileExtension(filename: string, fallback: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return fallback;
  const raw = filename.slice(dot).toLowerCase();
  if (!/^\.[a-z0-9]{1,10}$/.test(raw)) return fallback;
  return raw;
}

function validateUpload(kind: UploadKind, contentType: string, fileSize: number) {
  const normalizedType = contentType.toLowerCase();

  if ((kind === "avatar" || kind === "banner") && !normalizedType.startsWith("image/")) {
    throw new Error(`INVALID_FILE_TYPE: ${kind === "avatar" ? "Avatar" : "Banner"} must be an image`);
  }
  if (kind === "audio" && !normalizedType.startsWith("audio/")) {
    throw new Error("INVALID_FILE_TYPE: Audio upload must be an audio file");
  }

  const maxSize = UPLOAD_LIMITS[kind];
  if (fileSize <= 0 || fileSize > maxSize) {
    throw new Error(`FILE_TOO_LARGE: Max upload size is ${Math.floor(maxSize / (1024 * 1024))}MB`);
  }
}

function isUploadKind(value: string): value is UploadKind {
  return value === "avatar" || value === "banner" || value === "audio";
}

function isAllowedOrigin(origin: string): boolean {
  if (trustedOrigins.includes(origin)) return true;
  return /^http:\/\/localhost:\d+$/.test(origin);
}

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (!origin || !isAllowedOrigin(origin)) return headers;
  headers["Access-Control-Allow-Origin"] = origin;
  headers["Access-Control-Allow-Credentials"] = "true";
  headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
  headers["Vary"] = "Origin";
  return headers;
}

function parseUploadError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "UPLOAD_FAILED: Unknown error";
  const match = raw.match(/^[A-Z_]+:\s*(.*)$/);
  return match?.[1] ?? raw;
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("Rate limit exceeded");
}

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_PUBLIC;
  const publicBaseUrl = process.env.MEDIA_PUBLIC_BASE_URL;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    throw new Error(
      "R2_CONFIG_MISSING: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_PUBLIC, and MEDIA_PUBLIC_BASE_URL"
    );
  }

  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

async function buildSignedUpload(params: {
  kind: UploadKind;
  filename: string;
  contentType: string;
  profileId: string;
}) {
  const { kind, filename, contentType, profileId } = params;
  const { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl } = getR2Config();

  const extension = normalizeFileExtension(filename, DEFAULT_EXTENSIONS[kind]);
  const randomPart = Math.random().toString(36).slice(2, 10);
  const key = `${kind}/${profileId}/${Date.now()}-${randomPart}${extension}`;

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const endpoint = `https://${host}`;
  const canonicalUri = `/${bucket}/${key
    .split("/")
    .map((part) => encodeRfc3986(part))
    .join("/")}`;

  const now = new Date();
  const { amzDate, dateStamp } = getTimestampFields(now);
  const region = "auto";
  const service = "s3";
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const queryParams: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${accessKeyId}/${credentialScope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(SIGNED_UPLOAD_TTL_SECONDS)],
    ["X-Amz-SignedHeaders", "host"],
  ];

  const canonicalQuery = queryParams
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join("&");

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = "host";
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hashedCanonicalRequest,
  ].join("\n");

  const kDate = await hmacSha256(
    new TextEncoder().encode(`AWS4${secretAccessKey}`),
    dateStamp
  );
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const uploadUrl = `${endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  const normalizedPublicBase = publicBaseUrl.replace(/\/+$/, "");
  const publicUrl = `${normalizedPublicBase}/${key}`;

  return {
    uploadUrl,
    publicUrl,
    key,
    expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS,
    method: "PUT" as const,
    headers: {
      "Content-Type": contentType,
    },
  };
}

export const getProfileByAuthIdentity = internalQuery({
  args: {
    authIssuer: v.string(),
    authSubject: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("profiles")
      .withIndex("by_auth_identity", (q) =>
        q.eq("authIssuer", args.authIssuer).eq("authSubject", args.authSubject)
      )
      .first();
  },
});

export const createUploadSession = internalMutation({
  args: {
    ownerProfileId: v.id("profiles"),
    kind: v.union(v.literal("avatar"), v.literal("banner"), v.literal("audio")),
    objectKey: v.string(),
    publicUrl: v.string(),
    contentType: v.string(),
    fileSize: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await checkRateLimit(ctx, "uploadInit", `${args.ownerProfileId}:${args.kind}`);

    return await ctx.db.insert("upload_sessions", {
      ownerProfileId: args.ownerProfileId,
      kind: args.kind,
      objectKey: args.objectKey,
      publicUrl: args.publicUrl,
      contentType: args.contentType,
      fileSize: args.fileSize,
      status: "initiated",
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });
  },
});

export const getUploadSessionById = internalQuery({
  args: {
    uploadSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.uploadSessionId as Id<"upload_sessions">);
  },
});

export const markUploadSessionExpired = internalMutation({
  args: {
    uploadSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.uploadSessionId as Id<"upload_sessions">, {
      status: "expired",
    });
  },
});

export const markUploadSessionReady = internalMutation({
  args: {
    uploadSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.uploadSessionId as Id<"upload_sessions">, {
      status: "ready",
      finalizedAt: Date.now(),
    });
  },
});

export const uploadFromAppOptions = httpAction(async (_ctx, request) => {
  const origin = request.headers.get("origin");
  if (origin && !isAllowedOrigin(origin)) {
    return new Response(JSON.stringify({ error: "ORIGIN_NOT_ALLOWED" }), {
      status: 403,
      headers: buildCorsHeaders(origin),
    });
  }
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(origin),
  });
});

export const uploadFromApp = httpAction(async (ctx, request) => {
  const origin = request.headers.get("origin");
  const corsHeaders = buildCorsHeaders(origin);
  if (origin && !isAllowedOrigin(origin)) {
    return new Response(JSON.stringify({ error: "ORIGIN_NOT_ALLOWED" }), {
      status: 403,
      headers: corsHeaders,
    });
  }

  try {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return new Response(JSON.stringify({ error: "NOT_AUTHENTICATED" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const profile = await ctx.runQuery(internal.media.getProfileByAuthIdentity, {
      authIssuer: identity.issuer,
      authSubject: identity.subject,
    });

    if (!profile) {
      return new Response(JSON.stringify({ error: "PROFILE_REQUIRED" }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    const payload = (await request.json().catch(() => null)) as
      | {
          kind?: string;
          filename?: string;
          contentType?: string;
          fileSize?: number;
        }
      | null;
    if (!payload) {
      return new Response(JSON.stringify({ error: "INVALID_REQUEST_BODY" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const kindInput = `${payload.kind ?? ""}`.trim().toLowerCase();
    if (!isUploadKind(kindInput)) {
      return new Response(JSON.stringify({ error: "INVALID_KIND" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const filename =
      (typeof payload.filename === "string" && payload.filename.length > 0)
        ? payload.filename
        : `upload${DEFAULT_EXTENSIONS[kindInput]}`;
    const contentType =
      (typeof payload.contentType === "string" && payload.contentType.length > 0)
        ? payload.contentType
        : "application/octet-stream";
    const fileSize = typeof payload.fileSize === "number" ? payload.fileSize : 0;

    validateUpload(kindInput, contentType, fileSize);

    const signed = await buildSignedUpload({
      kind: kindInput,
      filename,
      contentType,
      profileId: profile._id,
    });

    const expiresAt = Date.now() + UPLOAD_SESSION_TTL_SECONDS * 1000;
    const uploadSessionId = await ctx.runMutation(internal.media.createUploadSession, {
      ownerProfileId: profile._id,
      kind: kindInput,
      objectKey: signed.key,
      publicUrl: signed.publicUrl,
      contentType,
      fileSize,
      expiresAt,
    });

    return new Response(
      JSON.stringify({
        uploadSessionId,
        uploadUrl: signed.uploadUrl,
        method: signed.method,
        headers: signed.headers,
        expiresInSeconds: signed.expiresInSeconds,
        publicUrl: signed.publicUrl,
        key: signed.key,
      }),
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error) {
    const status = isRateLimitError(error) ? 429 : 500;
    const errorCode = isRateLimitError(error) ? "RATE_LIMITED" : "UPLOAD_FAILED";
    return new Response(
      JSON.stringify({
        error: errorCode,
        details: parseUploadError(error),
      }),
      {
        status,
        headers: corsHeaders,
      }
    );
  }
});

export const finalizeUploadOptions = httpAction(async (_ctx, request) => {
  const origin = request.headers.get("origin");
  if (origin && !isAllowedOrigin(origin)) {
    return new Response(JSON.stringify({ error: "ORIGIN_NOT_ALLOWED" }), {
      status: 403,
      headers: buildCorsHeaders(origin),
    });
  }
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(origin),
  });
});

async function verifyUploadedObjectExists(session: {
  publicUrl: string;
  contentType: string;
  fileSize: number;
}) {
  const response = await fetch(session.publicUrl, { method: "HEAD" });
  if (!response.ok) {
    throw new Error("UPLOAD_VERIFY_FAILED: Uploaded object not found");
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (contentType && !contentType.startsWith(session.contentType.toLowerCase())) {
    throw new Error("UPLOAD_VERIFY_FAILED: Uploaded object content type mismatch");
  }

  const contentLengthRaw = response.headers.get("content-length");
  if (contentLengthRaw) {
    const contentLength = Number(contentLengthRaw);
    if (Number.isFinite(contentLength) && contentLength !== session.fileSize) {
      throw new Error("UPLOAD_VERIFY_FAILED: Uploaded object size mismatch");
    }
  }
}

export const finalizeUploadFromApp = httpAction(async (ctx, request) => {
  const origin = request.headers.get("origin");
  const corsHeaders = buildCorsHeaders(origin);
  if (origin && !isAllowedOrigin(origin)) {
    return new Response(JSON.stringify({ error: "ORIGIN_NOT_ALLOWED" }), {
      status: 403,
      headers: corsHeaders,
    });
  }

  try {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return new Response(JSON.stringify({ error: "NOT_AUTHENTICATED" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const profile = await ctx.runQuery(internal.media.getProfileByAuthIdentity, {
      authIssuer: identity.issuer,
      authSubject: identity.subject,
    });
    if (!profile) {
      return new Response(JSON.stringify({ error: "PROFILE_REQUIRED" }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    const payload = (await request.json().catch(() => null)) as
      | { uploadSessionId?: string }
      | null;
    const uploadSessionId = payload?.uploadSessionId;
    if (!uploadSessionId || typeof uploadSessionId !== "string") {
      return new Response(JSON.stringify({ error: "UPLOAD_SESSION_ID_REQUIRED" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const session = (await ctx.runQuery(internal.media.getUploadSessionById, {
      uploadSessionId,
    })) as UploadSessionDoc | null;

    if (!session) {
      return new Response(JSON.stringify({ error: "UPLOAD_SESSION_NOT_FOUND" }), {
        status: 404,
        headers: corsHeaders,
      });
    }
    if (session.ownerProfileId !== profile._id) {
      return new Response(JSON.stringify({ error: "UPLOAD_SESSION_OWNER_MISMATCH" }), {
        status: 403,
        headers: corsHeaders,
      });
    }
    if (session.status === "consumed") {
      return new Response(JSON.stringify({ error: "UPLOAD_SESSION_ALREADY_CONSUMED" }), {
        status: 409,
        headers: corsHeaders,
      });
    }
    if (session.status === "expired") {
      return new Response(JSON.stringify({ error: "UPLOAD_SESSION_EXPIRED" }), {
        status: 410,
        headers: corsHeaders,
      });
    }
    if (session.expiresAt < Date.now()) {
      await ctx.runMutation(internal.media.markUploadSessionExpired, {
        uploadSessionId,
      });
      return new Response(JSON.stringify({ error: "UPLOAD_SESSION_EXPIRED" }), {
        status: 410,
        headers: corsHeaders,
      });
    }

    if (session.status === "initiated") {
      await verifyUploadedObjectExists(session);
      await ctx.runMutation(internal.media.markUploadSessionReady, {
        uploadSessionId,
      });
    }

    return new Response(
      JSON.stringify({
        uploadSessionId: session._id,
        publicUrl: session.publicUrl,
        key: session.objectKey,
      }),
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "UPLOAD_FINALIZE_FAILED",
        details: parseUploadError(error),
      }),
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
});
