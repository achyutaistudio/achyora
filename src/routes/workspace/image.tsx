import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Composer } from "@/components/Composer";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import { generateImageFn } from "@/lib/achyora.functions";
import { track } from "@/lib/analytics";

export const Route = createFileRoute("/workspace/image")({
  head: () => ({
    meta: [
      { title: "Image — ACHYORA Workspace" },
      {
        name: "description",
        content:
          "Generate images with the AI provider configured on this ACHYORA deployment.",
      },
      { property: "og:title", content: "Image — ACHYORA Workspace" },
      {
        property: "og:description",
        content:
          "Describe an image and ACHYORA renders it with your configured provider.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ImageSurface,
});

const RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16"] as const;
const STYLES = [
  "none",
  "photographic",
  "cinematic",
  "illustration",
  "minimal",
  "traditional Indian art",
] as const;

function ImageSurface() {
  const qc = useQueryClient();
  const generate = useServerFn(generateImageFn);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState("");
  const [ratio, setRatio] = useState<string>("1:1");
  const [style, setStyle] = useState<string>("none");
  const [error, setError] = useState<{ code?: string; message: string } | null>(
    null,
  );

  async function submit(prompt: string) {
    setBusy(true);
    setError(null);
    setUrl(null);
    setLastPrompt(prompt);
    track("image_generation_started");
    try {
      const result = await generate({
        data: { prompt, aspectRatio: ratio, style },
      });
      if (!result.ok) {
        setError({
          ...(result.code ? { code: result.code } : {}),
          message: result.message,
        });
        return;
      }
      setUrl(result.url);
      track("image_generation_completed");
      await qc.invalidateQueries({ queryKey: ["account"] });
    } finally {
      setBusy(false);
    }
  }

  const submitOnce = useSingleFlight((prompt: string) => submit(prompt));

  return (
    <WorkspacePage
      title="Image"
      description="Describe what you want. Nothing is generated unless a real image provider is configured here."
    >
      <div className="mt-6 flex flex-wrap gap-3">
        <Select
          label="Aspect ratio"
          value={ratio}
          onChange={setRatio}
          options={[...RATIOS]}
        />
        <Select
          label="Style"
          value={style}
          onChange={setStyle}
          options={[...STYLES]}
        />
      </div>

      <div className="mt-5">
        <Composer
          onSubmit={(v) => void submitOnce(v)}
          busy={busy}
          placeholder="Describe the image…"
          hint="3 credits per image."
        />
      </div>

      <div className="mt-8">
        {error ? (
          <ErrorState
            {...(error.code ? { code: error.code } : {})}
            message={error.message}
          />
        ) : null}
        {busy ? <LoadingState label="Rendering your image…" /> : null}
        {!busy && !url && !error ? (
          <EmptyState
            title="No image yet"
            description="Your generated images appear here and are saved to your account."
          />
        ) : null}
        {url ? (
          <figure className="overflow-hidden rounded-2xl border border-border bg-card">
            <img src={url} alt={lastPrompt} className="w-full" loading="lazy" />
            <figcaption className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground">
              <span className="truncate">{lastPrompt}</span>
              <a
                href={url}
                download="achyora-image.png"
                className="shrink-0 text-foreground underline"
              >
                Download
              </a>
            </figcaption>
          </figure>
        ) : null}
      </div>
    </WorkspacePage>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl border border-input bg-secondary px-2.5 py-1.5 text-sm normal-case tracking-normal text-foreground"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
