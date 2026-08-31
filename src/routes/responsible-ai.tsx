import { createFileRoute } from "@tanstack/react-router";

import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

const SECTIONS = [
  {
    t: "Honest uncertainty",
    d: "ACHYORA is built to say what it does not know. Research and Sanatan answers separate evidence from interpretation and never invent sources or citations.",
  },
  {
    t: "Server-side model access",
    d: "All model calls run on our servers. Provider keys are never exposed to the browser, and prompts are never sent from client code directly to a provider.",
  },
  {
    t: "Data ownership",
    d: "Conversations, uploaded files and generated media are scoped to your account with database-level access rules. Guests are rate-limited without storing personal identifiers.",
  },
  {
    t: "Cultural respect",
    d: "Indian knowledge traditions are treated as living scholarship, not decoration. ACHYORA presents multiple positions where they exist rather than flattening them.",
  },
  {
    t: "Limits of the system",
    d: "ACHYORA can be wrong. It is not a substitute for medical, legal, or financial professionals, and outputs should be verified before consequential decisions.",
  },
];

export const Route = createFileRoute("/responsible-ai")({
  head: () => ({
    meta: [
      { title: "Responsible AI — ACHYORA" },
      {
        name: "description",
        content:
          "How ACHYORA handles uncertainty, data ownership, server-side model access and cultural responsibility.",
      },
      { property: "og:title", content: "Responsible AI — ACHYORA" },
      {
        property: "og:description",
        content:
          "ACHYORA's commitments on honesty, privacy and cultural responsibility.",
      },
    ],
  }),
  component: ResponsibleAI,
});

function ResponsibleAI() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
        <h1
          className="text-3xl text-foreground sm:text-4xl"
          style={{ fontWeight: 800 }}
        >
          Responsible AI
        </h1>
        <div className="mt-10 space-y-8">
          {SECTIONS.map((s) => (
            <section key={s.t}>
              <h2
                className="text-lg text-foreground"
                style={{ fontWeight: 600 }}
              >
                {s.t}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
