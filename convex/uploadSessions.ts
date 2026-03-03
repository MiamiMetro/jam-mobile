import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

type UploadKind = "avatar" | "banner" | "audio";

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
  usedAt?: number;
};

export async function consumeReadyUploadSessionByPublicUrl(
  ctx: MutationCtx,
  args: {
    ownerProfileId: Id<"profiles">;
    publicUrl: string;
    kind: UploadKind;
  }
): Promise<UploadSessionDoc> {
  const normalizedUrl = args.publicUrl.trim();
  const db = ctx.db as any;
  const session = (await db
    .query("upload_sessions")
    .withIndex("by_public_url", (q: any) => q.eq("publicUrl", normalizedUrl))
    .first()) as UploadSessionDoc | null;

  if (!session) {
    throw new Error("UPLOAD_SESSION_REQUIRED: Managed media URL must come from a finalized upload");
  }
  if (session.ownerProfileId !== args.ownerProfileId) {
    throw new Error("UPLOAD_SESSION_OWNER_MISMATCH: Upload session does not belong to current user");
  }
  if (session.kind !== args.kind) {
    throw new Error("UPLOAD_SESSION_KIND_MISMATCH: Upload session kind does not match target field");
  }
  if (session.status !== "ready" || session.usedAt !== undefined) {
    throw new Error("UPLOAD_SESSION_NOT_READY: Upload session is not ready for consumption");
  }
  if (session.expiresAt < Date.now()) {
    await db.patch(session._id, { status: "expired" });
    throw new Error("UPLOAD_SESSION_EXPIRED: Upload session has expired");
  }

  await db.patch(session._id, {
    status: "consumed",
    usedAt: Date.now(),
  });

  return session;
}
