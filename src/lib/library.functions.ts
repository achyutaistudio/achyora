import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fail, type AchyoraResult } from "@/lib/errors";
import { consumeRateLimit } from "@/lib/ratelimit.server";
import {
  isAllowedMime,
  isOwnedPath,
  kindForMime,
  maxUploadBytes,
  readStorageFacts,
  removeStorageObject,
  sanitizeFileName,
  signStorageObject,
} from "@/lib/library.server";

export type LibraryItem = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  kind: string;
  storage_path: string;
  created_at: string;
};

/** Upload constraints, so the browser can pre-check without owning the rule. */
export const getLibraryLimits = createServerFn({ method: "GET" }).handler(
  async () => ({
    maxBytes: maxUploadBytes(),
  }),
);

/**
 * The exact storage path the browser must upload to. Derived from the verified
 * session, never from a client-supplied user id.
 */
export const prepareLibraryUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { fileName: string; size: number }) => input)
  .handler(
    async ({
      data,
      context,
    }): Promise<AchyoraResult<{ storagePath: string; maxBytes: number }>> => {
      const limit = await consumeRateLimit("library_write", context.userId);
      if (!limit.allowed) return fail("RATE_LIMITED");

      const max = maxUploadBytes();
      if (!Number.isFinite(data.size) || data.size <= 0)
        return fail("INVALID_INPUT", "That file looks empty.");
      if (data.size > max)
        return fail(
          "FILE_TOO_LARGE",
          `Keep files under ${Math.floor(max / (1024 * 1024))} MB.`,
        );

      const safe = sanitizeFileName(data.fileName);
      const storagePath = `${context.userId}/${Date.now()}-${safe}`;
      return { ok: true, storagePath, maxBytes: max };
    },
  );

/**
 * Registers an uploaded object. The server re-reads the object's real size and
 * MIME type from Storage; anything oversized or disallowed is deleted again and
 * never gets a metadata record.
 */
export const registerLibraryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { storagePath: string }) => input)
  .handler(
    async ({
      data,
      context,
    }): Promise<AchyoraResult<{ item: LibraryItem }>> => {
      const path = (data.storagePath ?? "").trim();
      if (!isOwnedPath(path, context.userId)) return fail("UNAUTHORIZED");

      let facts;
      try {
        facts = await readStorageFacts(context.userId, path);
      } catch (err) {
        console.error(
          "library metadata read failed",
          err instanceof Error ? err.message : err,
        );
        return fail("UNKNOWN", "That upload could not be verified.");
      }
      if (!facts)
        return fail("NOT_FOUND", "That upload was not found in storage.");

      const max = maxUploadBytes();
      if (facts.size > max) {
        await removeStorageObject(path);
        return fail(
          "FILE_TOO_LARGE",
          `Keep files under ${Math.floor(max / (1024 * 1024))} MB.`,
        );
      }
      if (!isAllowedMime(facts.mimeType)) {
        await removeStorageObject(path);
        return fail(
          "INVALID_INPUT",
          "That file type isn't allowed in the Library.",
        );
      }

      const { data: row, error } = await context.supabase
        .from("library_items")
        .insert({
          user_id: context.userId,
          storage_path: path,
          file_name: facts.name.replace(/^\d+-/, ""),
          mime_type: facts.mimeType,
          size_bytes: facts.size,
          kind: kindForMime(facts.mimeType),
        })
        .select(
          "id, file_name, mime_type, size_bytes, kind, storage_path, created_at",
        )
        .single();

      if (error || !row) {
        await removeStorageObject(path);
        console.error("library insert failed", error?.message);
        return fail("UNKNOWN", "That file could not be saved to your library.");
      }

      return { ok: true, item: row as LibraryItem };
    },
  );

export const listLibraryItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LibraryItem[]> => {
    const { data, error } = await context.supabase
      .from("library_items")
      .select(
        "id, file_name, mime_type, size_bytes, kind, storage_path, created_at",
      )
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as LibraryItem[];
  });

/** Short-lived signed url. Ownership is proven by the RLS-scoped lookup. */
export const openLibraryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(
    async ({ data, context }): Promise<AchyoraResult<{ url: string }>> => {
      const { data: row } = await context.supabase
        .from("library_items")
        .select("storage_path")
        .eq("id", data.id)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (!row) return fail("NOT_FOUND");
      const url = await signStorageObject(row.storage_path, 60);
      if (!url) return fail("UNKNOWN", "That file could not be opened.");
      return { ok: true, url };
    },
  );

/** Deletes BOTH the storage object and the metadata record. */
export const deleteLibraryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(
    async ({ data, context }): Promise<AchyoraResult<{ deleted: true }>> => {
      const { data: row } = await context.supabase
        .from("library_items")
        .select("id, storage_path")
        .eq("id", data.id)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (!row) return fail("NOT_FOUND");

      // Path comes from the database row, never from the request.
      await removeStorageObject(row.storage_path);
      const { error } = await context.supabase
        .from("library_items")
        .delete()
        .eq("id", row.id)
        .eq("user_id", context.userId);
      if (error) return fail("UNKNOWN", "That file could not be removed.");
      return { ok: true, deleted: true };
    },
  );
