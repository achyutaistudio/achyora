/**
 * Library server helpers.
 *
 * Trust model: the browser uploads straight to Supabase Storage (storage RLS
 * already confines every user to their own `{uid}/` folder), then asks the
 * server to register the object. The server re-reads the object's REAL
 * metadata from Storage with the service role and validates that — the
 * client's claimed size, filename, MIME type and owner are never trusted.
 *
 * Server-only by filename.
 */
import { serverEnv } from "@/lib/env.server";

export const LIBRARY_BUCKET = "library";

/** 20 MB — the limit the Library surface has always documented. */
export const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function maxUploadBytes(): number {
  const raw = serverEnv("LIBRARY_MAX_UPLOAD_BYTES");
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_UPLOAD_BYTES;
}

const ALLOWED_MIME_PREFIXES = ["image/", "audio/", "video/", "text/"];
const ALLOWED_MIME_EXACT = new Set([
  "application/pdf",
  "application/json",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export function allowedMimeTypes(): { prefixes: string[]; exact: Set<string> } {
  const extra = serverEnv("LIBRARY_EXTRA_MIME_TYPES");
  if (!extra)
    return { prefixes: ALLOWED_MIME_PREFIXES, exact: ALLOWED_MIME_EXACT };
  const exact = new Set(ALLOWED_MIME_EXACT);
  for (const t of extra.split(",").map((v) => v.trim().toLowerCase()))
    if (t) exact.add(t);
  return { prefixes: ALLOWED_MIME_PREFIXES, exact };
}

export function isAllowedMime(mime: string): boolean {
  const value = (mime || "").toLowerCase().split(";")[0]?.trim() ?? "";
  if (!value) return false;
  const { prefixes, exact } = allowedMimeTypes();
  return prefixes.some((p) => value.startsWith(p)) || exact.has(value);
}

export function kindForMime(mime: string): string {
  const value = (mime || "").toLowerCase();
  if (value.startsWith("image/")) return "image";
  if (value.startsWith("audio/")) return "audio";
  if (value.startsWith("video/")) return "video";
  if (value.startsWith("text/") || value === "application/pdf")
    return "document";
  return "file";
}

/** Strips anything that could escape the user's own folder. */
export function sanitizeFileName(name: string): string {
  const base = (name || "file").split(/[\\/]/).pop() ?? "file";
  const safe = base.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  return safe.replace(/^\.+/, "") || "file";
}

/**
 * A storage path is valid only when it is exactly `{userId}/{safe-name}`.
 * No traversal, no nesting, no other user's folder.
 */
export function isOwnedPath(path: string, userId: string): boolean {
  if (!path || path.includes("..") || path.startsWith("/")) return false;
  const parts = path.split("/");
  if (parts.length !== 2) return false;
  return (
    parts[0] === userId &&
    Boolean(parts[1]) &&
    parts[1] === sanitizeFileName(parts[1]!)
  );
}

export type StorageObjectFacts = {
  size: number;
  mimeType: string;
  name: string;
};

/** Reads the object's real, server-side metadata. Never trusts the client. */
export async function readStorageFacts(
  userId: string,
  path: string,
): Promise<StorageObjectFacts | null> {
  const { supabaseAdmin } =
    await import("@/integrations/supabase/client.server");
  const fileName = path.slice(userId.length + 1);
  const { data, error } = await supabaseAdmin.storage
    .from(LIBRARY_BUCKET)
    .list(userId, { limit: 100, search: fileName });
  if (error) throw new Error(error.message);
  const match = (data ?? []).find((f) => f.name === fileName);
  if (!match) return null;
  const meta = (match.metadata ?? {}) as { size?: number; mimetype?: string };
  return {
    size: Number(meta.size ?? 0),
    mimeType: String(meta.mimetype ?? "application/octet-stream"),
    name: match.name,
  };
}

export async function removeStorageObject(path: string): Promise<void> {
  const { supabaseAdmin } =
    await import("@/integrations/supabase/client.server");
  await supabaseAdmin.storage.from(LIBRARY_BUCKET).remove([path]);
}

export async function signStorageObject(
  path: string,
  seconds = 60,
): Promise<string | null> {
  const { supabaseAdmin } =
    await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.storage
    .from(LIBRARY_BUCKET)
    .createSignedUrl(path, seconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}
