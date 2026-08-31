import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, BookOpenText, Search } from "lucide-react";

import { Composer } from "@/components/Composer";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { BriefView } from "@/routes/workspace/research";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import { runSanatanResearch } from "@/lib/achyora.functions";
import { track } from "@/lib/analytics";

export const Route = createFileRoute("/workspace/sanatan")({
  head: () => ({
    meta: [
      { title: "Sanatan Research — ACHYORA Workspace" },
      {
        name: "description",
        content:
          "Scholarly Sanatan research with classified evidence, multiple traditions and stated uncertainty.",
      },
      { property: "og:title", content: "Sanatan Research — ACHYORA Workspace" },
      {
        property: "og:description",
        content: "Respectful, source-classified answers across Sanatan traditions.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SanatanSurface,
});

type SanatanBrief = Parameters<typeof BriefView>[0]["brief"];

function SanatanSurface() {
  const qc = useQueryClient();
  const run = useServerFn(runSanatanResearch);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [brief, setBrief] = useState<SanatanBrief | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  async function submit(value: string) {
    setBusy(true);
    setError(null);
    setBrief(null);
    setQuery(value);
    track("sanatan_research_started");
    try {
      const result = await run({ data: { query: value } });
      if (!result.ok) {
        setError({ ...(result.code ? { code: result.code } : {}), message: result.message });
        return;
      }
      setBrief(result.brief as unknown as SanatanBrief);
      await qc.invalidateQueries({ queryKey: ["account"] });
    } finally {
      setBusy(false);
    }
  }

  // A single billable study per user intent, even on a double submit.
  const submitOnce = useSingleFlight((value: string) => submit(value));

  // Threads are derived from the brief that was actually returned — nothing is
  // invented here. Each one hands the question to the existing chat experience.
  const threads = brief
    ? [
        ...(brief.key_findings ?? []).map((f) => ({ label: f, prompt: `${query}\n\n${f}` })),
        ...(brief.evidence ?? []).map((e) => ({
          label: e.claim,
          prompt: `${query}\n\n${e.claim}`,
        })),
      ].slice(0, 6)
    : [];

  return (
    <WorkspacePage>
      <header className="mx-auto max-w-2xl pt-8 text-center sm:pt-14">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-border/70 bg-secondary/45 text-primary">
          <BookOpenText className="h-5 w-5" aria-hidden="true" />
        </div>
        <p className="mt-4 text-[0.65rem] uppercase tracking-[0.28em] text-muted-foreground">Sanatan</p>
        <h1 className="mt-3 text-balance text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">
          Ask with reverence. Study with clarity.
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Scripture, tradition, history and interpretation remain clearly distinguished.
        </p>
      </header>
      <div className="mx-auto mt-8 max-w-2xl">
        <Composer
          onSubmit={(v) => void submitOnce(v)}
          busy={busy}
          size="md"
          attachments={false}
          placeholder="Ask about a verse, text, tradition or practice…"
          hint="2 credits per brief. Sources are never invented."
        />
      </div>

      <div className="mx-auto mt-10 max-w-3xl space-y-8">
        {error ? (
          <ErrorState {...(error.code ? { code: error.code } : {})} message={error.message} />
        ) : null}
        {busy ? <LoadingState label="Studying the question…" /> : null}
        {!busy && !brief && !error ? (
          <EmptyState
            title="Nothing studied yet"
            description="Search above to receive a classified, respectful answer with its sources."
          />
        ) : null}

        {brief ? <BriefView brief={brief} /> : null}

        {threads.length > 0 ? (
          <section>
            <h2 className="text-sm text-foreground" style={{ fontWeight: 600 }}>
              Continue in conversation
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Open any point from this study in Chat to explore it further.
            </p>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {threads.map((t, i) => (
                <li key={i}>
                  <Link
                    to="/workspace/chat"
                    search={{ prompt: t.prompt }}
                    className="group flex h-full items-start gap-3 rounded-2xl border border-border bg-card p-4 text-left text-sm text-muted-foreground transition-colors hover:border-ring/60 hover:text-foreground"
                  >
                    <span className="line-clamp-3 min-w-0 flex-1">{t.label}</span>
                    <ArrowRight
                      className="mt-0.5 h-4 w-4 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </WorkspacePage>
  );
}
