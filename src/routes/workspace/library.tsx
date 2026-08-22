import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { supabase } from "@/integrations/supabase/client";
import {
  deleteLibraryItem,
  listLibraryItems,
  openLibraryItem,
  prepareLibraryUpload,
  registerLibraryItem,
} from "@/lib/library.functions";

export const Route = createFileRoute("/workspace/library")({
  head: () => ({
    meta: [
      { title: "Library — ACHYORA Workspace" },
      {
        name: "description",
        content: "Your private ACHYORA library: files stored under your own account only.",
      },
      { property: "og:title", content: "Library — ACHYORA Workspace" },
      {
        property: "og:description",
        content: "Upload and download your own files, private by default.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LibrarySurface,
});

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function LibrarySurface() {
  const qc = useQueryClient();
  const list = useServerFn(listLibraryItems);
  const prepare = useServerFn(prepareLibraryUpload);
  const register = useServerFn(registerLibraryItem);
  const open = useServerFn(openLibraryItem);
  const remove = useServerFn(deleteLibraryItem);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const files = useQuery({ queryKey: ["library"], queryFn: () => list() });

  async function upload(file: File) {
    setError(null);
    setBusy(true);
    try {
      // The server owns the path, the size limit and the type policy.
      const target = await prepare({ data: { fileName: file.name, size: file.size } });
      if (!target.ok) {
        setError(target.message);
        return;
      }

      const { error: uploadError } = await supabase.storage
        .from("library")
        .upload(target.storagePath, file, { contentType: file.type || "application/octet-stream" });
      if (uploadError) throw new Error(uploadError.message);

      // Registration re-reads the object's real metadata server-side and
      // deletes it again if it violates policy.
      const saved = await register({ data: { storagePath: target.storagePath } });
      if (!saved.ok) {
        setError(saved.message);
        return;
      }
      await qc.invalidateQueries({ queryKey: ["library"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function openItem(id: string) {
    setError(null);
    const result = await open({ data: { id } });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  async function removeItem(id: string) {
    setError(null);
    const result = await remove({ data: { id } });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["library"] });
  }

  return (
    <WorkspacePage
      title="Library"
      description="Files are stored privately under your account. Nobody else can list or read them."
    >
      <label className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-input bg-secondary px-4 py-2.5 text-sm text-foreground">
        <input
          type="file"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
        {busy ? "Uploading…" : "Upload a file"}
      </label>

      <div className="mt-8">
        {error ? <ErrorState message={error} /> : null}
        {files.isPending ? <LoadingState label="Loading your library…" /> : null}
        {files.isError ? <ErrorState message="Your library could not be loaded." /> : null}
        {files.data && files.data.length === 0 ? (
          <EmptyState
            title="Nothing stored yet"
            description="Upload a document or image to keep it with your account."
          />
        ) : null}
        <ul className="space-y-2">
          {(files.data ?? []).map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm text-foreground">{f.file_name}</span>
                <span className="block text-xs text-muted-foreground">
                  {f.kind} · {formatSize(Number(f.size_bytes))}
                </span>
              </span>
              <span className="flex shrink-0 gap-3 text-sm">
                <button onClick={() => void openItem(f.id)} className="text-foreground underline">
                  Open
                </button>
                <button
                  onClick={() => void removeItem(f.id)}
                  className="text-destructive underline"
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </WorkspacePage>
  );
}
