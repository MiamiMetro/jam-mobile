import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";

declare const process: {
  env: Record<string, string | undefined>;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 100;
const MAX_BATCHES_PER_STATUS = 5;
const CONSUMED_RETENTION_DAYS = 7;
const DELETE_URL_TTL_SECONDS = 300;

type UploadStatus = "initiated" | "ready" | "consumed" | "expired";

type UploadSessionDoc = {
  _id: Id<"upload_sessions">;
  ownerProfileId: Id<"profiles">;
  kind: "avatar" | "banner" | "audio";
  objectKey: string;
  publicUrl: string;
  contentType: string;
  fileSize: number;
  status: UploadStatus;
  expiresAt: number;
  createdAt: number;
  finalizedAt?: number;
  usedAt?: number;
};

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

function getR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_PUBLIC;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

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
  return await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(data)
  );
}

function getTimestampFields(now: Date) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

async function buildSignedDeleteUrl(config: R2Config, objectKey: string): Promise<string> {
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const endpoint = `https://${host}`;
  const canonicalUri = `/${config.bucket}/${objectKey
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
    ["X-Amz-Credential", `${config.accessKeyId}/${credentialScope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(DELETE_URL_TTL_SECONDS)],
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
    "DELETE",
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
    new TextEncoder().encode(`AWS4${config.secretAccessKey}`),
    dateStamp
  );
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  return `${endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

async function deleteR2Object(config: R2Config, objectKey: string): Promise<boolean> {
  const url = await buildSignedDeleteUrl(config, objectKey);
  const response = await fetch(url, { method: "DELETE" });
  if (response.status === 200 || response.status === 202 || response.status === 204) {
    return true;
  }
  if (response.status === 404) {
    return true;
  }
  return false;
}

export const listExpiredSessionsByStatus = internalQuery({
  args: {
    status: v.union(
      v.literal("initiated"),
      v.literal("ready"),
      v.literal("consumed"),
      v.literal("expired")
    ),
    before: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    return (await ctx.db
      .query("upload_sessions")
      .withIndex("by_status_expires", (q) =>
        q.eq("status", args.status).lt("expiresAt", args.before)
      )
      .take(Math.max(1, Math.min(args.limit, CLEANUP_BATCH_SIZE)))) as UploadSessionDoc[];
  },
});

export const deleteUploadSessionsById = internalMutation({
  args: {
    ids: v.array(v.id("upload_sessions")),
  },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      await ctx.db.delete(id);
    }
    return args.ids.length;
  },
});

export const runDailyCleanup = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const consumedBefore = now - CONSUMED_RETENTION_DAYS * DAY_MS;
    const r2Config = getR2Config();

    let scanned = 0;
    let objectDeleteSuccess = 0;
    let objectDeleteErrors = 0;
    let sessionRowsDeleted = 0;

    const statusesForObjectCleanup: UploadStatus[] = ["initiated", "ready", "expired"];
    for (const status of statusesForObjectCleanup) {
      for (let batch = 0; batch < MAX_BATCHES_PER_STATUS; batch += 1) {
        const rows = (await ctx.runQuery(
          (internal as any).mediaCleanup.listExpiredSessionsByStatus,
          {
            status,
            before: now,
            limit: CLEANUP_BATCH_SIZE,
          }
        )) as UploadSessionDoc[];

        if (rows.length === 0) break;
        scanned += rows.length;

        const deletableIds: Id<"upload_sessions">[] = [];
        for (const row of rows) {
          if (!r2Config) {
            objectDeleteErrors += 1;
            continue;
          }

          const deleted = await deleteR2Object(r2Config, row.objectKey);
          if (deleted) {
            objectDeleteSuccess += 1;
            deletableIds.push(row._id);
          } else {
            objectDeleteErrors += 1;
          }
        }

        if (deletableIds.length > 0) {
          sessionRowsDeleted += (await ctx.runMutation(
            (internal as any).mediaCleanup.deleteUploadSessionsById,
            {
              ids: deletableIds,
            }
          )) as number;
        }
      }
    }

    for (let batch = 0; batch < MAX_BATCHES_PER_STATUS; batch += 1) {
      const consumedRows = (await ctx.runQuery(
        (internal as any).mediaCleanup.listExpiredSessionsByStatus,
        {
          status: "consumed",
          before: consumedBefore,
          limit: CLEANUP_BATCH_SIZE,
        }
      )) as UploadSessionDoc[];

      if (consumedRows.length === 0) break;
      scanned += consumedRows.length;
      const ids = consumedRows.map((row) => row._id);
      sessionRowsDeleted += (await ctx.runMutation(
        (internal as any).mediaCleanup.deleteUploadSessionsById,
        {
          ids,
        }
      )) as number;
    }

    return {
      now,
      scanned,
      objectDeleteSuccess,
      objectDeleteErrors,
      sessionRowsDeleted,
      r2ConfigPresent: !!r2Config,
    };
  },
});

