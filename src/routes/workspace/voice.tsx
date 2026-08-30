import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

import { ErrorState, LoadingState } from "@/components/States";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { transcribeVoice } from "@/lib/achyora.functions";
import { track } from "@/lib/analytics";

export const Route = createFileRoute("/workspace/voice")({
  head: () => ({
    meta: [
      { title: "Voice — ACHYORA Workspace" },
      {
        name: "description",
        content: "Speak to ACHYORA: your recording is transcribed and answered conversationally.",
      },
      { property: "og:title", content: "Voice — ACHYORA Workspace" },
      {
        property: "og:description",
        content: "Record a question and get a spoken-style reply from ACHYORA.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VoiceSurface,
});

function VoiceSurface() {
  const qc = useQueryClient();
  const send = useServerFn(transcribeVoice);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void upload(new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }));
      };
      rec.start();
      recorder.current = rec;
      setRecording(true);
      track("voice_started");
    } catch {
      setError({
        message: "Microphone access was blocked. Allow it in your browser to use voice.",
      });
    }
  }

  function stopRecording() {
    recorder.current?.stop();
    setRecording(false);
  }

  async function upload(blob: Blob) {
    setBusy(true);
    setTranscript("");
    setReply("");
    try {
      const buffer = await blob.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] as number);
      const base64 = btoa(binary);
      const result = await send({ data: { base64, mimeType: blob.type || "audio/webm" } });
      if (!result.ok) {
        setError({ ...(result.code ? { code: result.code } : {}), message: result.message });
        return;
      }
      setTranscript(result.transcript);
      setReply(result.reply);
      await qc.invalidateQueries({ queryKey: ["account"] });
    } catch {
      setError({ message: "That recording could not be sent. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <WorkspacePage
      title="Voice"
      description="Audio is transcribed on the server and never stored in your browser."
    >
      <div className="mt-6">
        <button
          onClick={() => (recording ? stopRecording() : void startRecording())}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ fontWeight: 600 }}
        >
          {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {recording ? "Stop and send" : "Start recording"}
        </button>
        <p className="mt-2 text-xs text-muted-foreground">
          2 credits per voice message. Keep it under a minute.
        </p>
      </div>
      <div className="mt-8 space-y-4">
        {error ? (
          <ErrorState {...(error.code ? { code: error.code } : {})} message={error.message} />
        ) : null}
        {busy ? <LoadingState label="Transcribing and replying…" /> : null}
        {transcript ? (
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">You said</p>
            <p className="mt-1.5 text-sm text-foreground">{transcript}</p>
          </div>
        ) : null}
        {reply ? (
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">ACHYORA</p>
            <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">{reply}</p>
          </div>
        ) : null}
      </div>
    </WorkspacePage>
  );
}
