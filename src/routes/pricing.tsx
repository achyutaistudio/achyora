import { createFileRoute } from "@tanstack/react-router";

import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { PLANS } from "@/lib/pricing";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — ACHYORA" },
      {
        name: "description",
        content:
          "ACHYORA pricing for India and international users. Free, Plus, Pro and Studio plans.",
      },
      { property: "og:title", content: "Pricing — ACHYORA" },
      {
        property: "og:description",
        content: "Transparent ACHYORA plans with India (₹) and international ($) pricing.",
      },
    ],
  }),
  component: Pricing,
});

function Pricing() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <h1 className="text-3xl text-foreground sm:text-4xl" style={{ fontWeight: 800 }}>
          Pricing
        </h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          Shown in Indian rupees and US dollars. Start free — no card needed.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className="flex flex-col rounded-2xl border border-border bg-card p-6"
              style={plan.highlight ? { borderColor: "var(--ring)" } : undefined}
            >
              <p className="text-sm text-muted-foreground">{plan.name}</p>
              <p className="mt-2 text-3xl text-foreground" style={{ fontWeight: 700 }}>
                {plan.price.INR}
              </p>
              <p className="text-sm text-muted-foreground">
                {plan.price.USD} · {plan.cadence}
              </p>
              {"features" in plan && Array.isArray((plan as { features?: string[] }).features) ? (
                <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
                  {(plan as { features: string[] }).features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
