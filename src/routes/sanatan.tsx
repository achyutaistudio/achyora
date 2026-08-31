import { createFileRoute, Link } from "@tanstack/react-router";

import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

const LABELS = [
  ["Scriptural", "What the text itself states, with the source named."],
  ["Traditional", "What lineages and commentators have held."],
  ["Historical", "What historians reconstruct from evidence."],
  ["Archaeological", "What material findings support."],
  ["Scholarly", "What modern academic study argues."],
  ["Disputed", "Where credible positions genuinely conflict."],
  ["Interpretive", "Where meaning depends on the reader's frame."],
  ["Uncertain", "Where the honest answer is that we do not know."],
];

export const Route = createFileRoute("/sanatan")({
  head: () => ({
    meta: [
      { title: "Sanatan Research — ACHYORA" },
      {
        name: "description",
        content:
          "ACHYORA's Sanatan Research studies Indian texts and philosophy with clearly labelled evidence and stated uncertainty — never invented citations.",
      },
      { property: "og:title", content: "Sanatan Research — ACHYORA" },
      {
        property: "og:description",
        content:
          "Scholarly study of Indian texts with labelled evidence and honest uncertainty.",
      },
    ],
  }),
  component: Sanatan,
});

function Sanatan() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
        <p className="text-[0.66rem] uppercase tracking-[0.24em] text-muted-foreground">
          Sanatan Research
        </p>
        <h1
          className="mt-4 text-3xl text-foreground sm:text-4xl"
          style={{ fontWeight: 800 }}
        >
          Depth without distortion
        </h1>
        <p className="mt-4 max-w-2xl text-sm text-muted-foreground sm:text-base">
          ACHYORA approaches Sanatan questions the way a careful scholar would:
          name the source, separate tradition from history, mark what is
          debated, and say plainly when something is unknown. It does not
          preach, it does not dismiss, and it never fabricates a citation.
        </p>
        <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
          {LABELS.map(([title, body]) => (
            <div key={title} className="bg-card p-6">
              <h2
                className="text-base text-foreground"
                style={{ fontWeight: 600 }}
              >
                {title}
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
        <Link
          to="/workspace"
          className="mt-10 inline-flex rounded-xl bg-primary px-5 py-3 text-sm text-primary-foreground transition-opacity hover:opacity-90"
          style={{ fontWeight: 600 }}
        >
          Start a Sanatan research session
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
