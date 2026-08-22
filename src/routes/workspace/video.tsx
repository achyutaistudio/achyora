import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Composer } from "@/components/Composer";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import { pollVideo, startVideo } from "@/lib/achyora.functions";
import { track } from "@/lib/analytics";

export const Route = createFileRoute("/workspace/video")({
  head: () => ({
    meta: [
      { title: "Video — ACHYORA Workspace" },
      {
        name: "description",
        content: "Queue a video generation job in ACHYORA and follow its real status.",
      },
      { property: "og:title", content: "Video — ACHYORA Workspace" },
      {
        property: "og:description",
        content: "Describe a scene and track the real generation job to completion.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VideoSurface,
});

/** Client-side ceiling; the server enforces its own VIDEO_MAX_POLL_SECONDS. */
const VIDEO_UI_ENABLED = false;
const MAX_POLL_MS = 10 * 60 * 1000;

function VideoSurface() {
  return VIDEO_UI_ENABLED ? <VideoEnabledSurface /> : <VideoDisabledSurface />;
}

function VideoDisabledSurface() {
  return (
    <WorkspacePage width="wide" className="flex min-h-full items-center justify-center px-6 py-10">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-8 text-center">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Video</p>
        <h1 className="mt-2 text-xl text-foreground" style={{ fontWeight: 650 }}>
          Video is currently disabled
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The video backend remains installed, but the user-facing video feature is intentionally
          disabled until it is enabled from the product configuration.
        </p>
      </div>
    </WorkspacePage>
  );
}

function VideoEnabledSurface() {
  const qc = useQueryClient();
  const start = useServerFn(startVideo);
  const poll = useServerFn(pollVideo);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [ratio, setRatio] = useState("16:9");
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef<number>(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function stopWatching() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  async function watch(jobId: string) {
    // Hard client-side ceiling as well as the server one: polling can never
    // run forever, whatever the provider does.
    if (Date.now() > deadline.current) {
      stopWatching();
      setError({ message: "The video job took too long. Your credits were returned." });
      setBusy(false);
      return;
    }

    const result = await poll({ data: { jobId } });
    if (!result.ok) {
      stopWatching();
      setError({ ...(result.code ? { code: result.code } : {}), message: result.message });
      setBusy(false);
      await qc.invalidateQueries({ queryKey: ["account"] });
      return;
    }
    setStatus(result.status);
    if (result.url) {
      stopWatching();
      setUrl(result.url);
      setBusy(false);
      track("video_generation_completed");
      return;
    }
    if (result.status === "failed") {
      stopWatching();
      setError({ message: "The video job failed at the provider. Your credits were returned." });
      setBusy(false);
      await qc.invalidateQueries({ queryKey: ["account"] });
      return;
    }
    timer.current = setTimeout(() => void watch(jobId), 5000);
  }

  async function submit(prompt: string) {
    setBusy(true);
    setError(null);
    setUrl(null);
    setStatus("queued");
    track("video_generation_started");
    const result = await start({ data: { prompt, aspectRatio: ratio } });
    if (!result.ok) {
      setError({ ...(result.code ? { code: result.code } : {}), message: result.message });
      setBusy(false);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["account"] });
    deadline.current = Date.now() + MAX_POLL_MS;
    void watch(result.jobId);
  }

  const submitOnce = useSingleFlight((prompt: string) => submit(prompt));

  return (
    <WorkspacePage
      title="Video"
      description="Video generation runs as a real job. ACHYORA shows the provider's actual status, never a fake progress bar."
    >
      <label className="mt-6 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
        Aspect ratio
        <select
          value={ratio}
          onChange={(e) => setRatio(e.target.value)}
          className="rounded-xl border border-input bg-secondary px-2.5 py-1.5 text-sm normal-case tracking-normal text-foreground"
        >
          {["16:9", "9:16", "1:1"].map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-5">
        <Composer
          onSubmit={(v) => void submitOnce(v)}
          busy={busy}
          placeholder="Describe the scene…"
          hint="8 credits per video."
        />
      </div>
      <div className="mt-8">
        {error ? (
          <ErrorState {...(error.code ? { code: error.code } : {})} message={error.message} />
        ) : null}
        {busy ? <LoadingState label={`Job status: ${status ?? "queued"}…`} /> : null}
        {!busy && !url && !error ? (
          <EmptyState
            title="No video yet"
            description="Generated videos appear here once the provider finishes."
          />
        ) : null}
        {url ? (
          <video src={url} controls className="w-full rounded-2xl border border-border" />
        ) : null}
      </div>
    </WorkspacePage>
  );
}
