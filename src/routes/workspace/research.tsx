import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Composer } from "@/components/Composer";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import { runResearch } from "@/lib/achyora.functions";
import { track } from "@/lib/analytics";

export const Route = createFileRoute("/workspace/research")({
  head: () => ({
    meta: [
      { title: "Research — ACHYORA Workspace" },
      {
        name: "description",
        content:
          "Evidence-first research briefs with explicit confidence and open questions.",
      },
      { property: "og:title", content: "Research — ACHYORA Workspace" },
      {
        property: "og:description",
        content:
          "Structured research with claims, basis and stated uncertainty.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResearchSurface,
});

type Brief = {
  summary: string;
  key_findings: string[];
  evidence: Array<{ claim: string; basis: string; confidence: string }>;
  open_questions: string[];
  sources: Array<{ title: string; reference: string; note?: string }>;
  confidence: string;
};

function ResearchSurface() {
  const qc = useQueryClient();
  const run = useServerFn(runResearch);
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(
    null,
  );

  async function submit(query: string) {
    setBusy(true);
    setError(null);
    setBrief(null);
    track("research_started");
    try {
      const result = await run({ data: { query } });
      if (!result.ok) {
        setError({
          ...(result.code ? { code: result.code } : {}),
          message: result.message,
        });
        return;
      }
      setBrief(result.brief as unknown as Brief);
      await qc.invalidateQueries({ queryKey: ["account"] });
    } finally {
      setBusy(false);
    }
  }

  const submitOnce = useSingleFlight((query: string) => submit(query));

  return (
    <WorkspacePage
      title="Research"
      description="ACHYORA separates what is well supported from what is uncertain, and never invents a citation."
    >
      <div className="mt-6">
        <Composer
          onSubmit={(v) => void submitOnce(v)}
          busy={busy}
          placeholder="What should ACHYORA research?"
          hint="2 credits per brief."
        />
      </div>

      <div className="mt-8">
        {error ? (
          <ErrorState
            {...(error.code ? { code: error.code } : {})}
            message={error.message}
          />
        ) : null}
        {busy ? <LoadingState label="Researching…" /> : null}
        {!busy && !brief && !error ? (
          <EmptyState
            title="No brief yet"
            description="Ask a question to get a structured, evidence-first answer."
          />
        ) : null}
        {brief ? <BriefView brief={brief} /> : null}
      </div>
    </WorkspacePage>
  );
}

export function BriefView({
  brief,
}: {
  brief: Brief & {
    perspectives?: Array<{ tradition: string; position: string }>;
  };
}) {
  return (
    <article className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-5">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Summary · confidence {brief.confidence}
        </p>
        <p className="mt-2 text-sm text-foreground">{brief.summary}</p>
      </section>

      {brief.key_findings?.length ? (
        <Section title="Key findings">
          <ul className="space-y-2 text-sm text-muted-foreground">
            {brief.key_findings.map((f, i) => (
              <li key={i}>• {f}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      {brief.perspectives?.length ? (
        <Section title="Perspectives">
          <ul className="space-y-3 text-sm">
            {brief.perspectives.map((p, i) => (
              <li key={i}>
                <span className="text-foreground" style={{ fontWeight: 600 }}>
                  {p.tradition}
                </span>
                <span className="text-muted-foreground"> — {p.position}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {brief.evidence?.length ? (
        <Section title="Evidence">
          <ul className="space-y-3 text-sm">
            {brief.evidence.map((e, i) => (
              <li key={i} className="rounded-xl border border-border p-3">
                <p className="text-foreground">{e.claim}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  {e.basis} · {e.confidence} confidence
                </p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {brief.open_questions?.length ? (
        <Section title="Open questions">
          <ul className="space-y-2 text-sm text-muted-foreground">
            {brief.open_questions.map((q, i) => (
              <li key={i}>• {q}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Sources">
        {brief.sources?.length ? (
          <ul className="space-y-2 text-sm text-muted-foreground">
            {brief.sources.map((s, i) => (
              <li key={i}>
                <span className="text-foreground">{s.title}</span> —{" "}
                {s.reference}
                {s.note ? ` (${s.note})` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No verifiable source was offered for this answer. Treat it as a
            starting point, not a citation.
          </p>
        )}
      </Section>
    </article>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-sm text-foreground" style={{ fontWeight: 600 }}>
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
