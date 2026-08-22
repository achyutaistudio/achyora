import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { BookOpen, Image as ImageIcon, Library, Mic, Search, Sparkles, Video } from "lucide-react";

import { AmbientSignature } from "@/components/AmbientSignature";
import { GuestChat } from "@/components/GuestChat";
import { KrishnaFormation } from "@/components/KrishnaFormation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { PLANS } from "@/lib/pricing";
import { track } from "@/lib/analytics";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ACHYORA — Inspired by Timeless Wisdom. Built for Humanity." },
      {
        name: "description",
        content:
          "Talk to ACHYORA instantly. An independent Indian-origin AI platform for chat, deep research, Sanatan research, image, video and voice.",
      },
      {
        property: "og:title",
        content: "ACHYORA — Inspired by Timeless Wisdom. Built for Humanity.",
      },
      {
        property: "og:description",
        content:
          "Start talking to ACHYORA from the homepage. No account needed for your first messages.",
      },
    ],
  }),
  component: Home,
});

const CAPABILITIES = [
  {
    icon: Sparkles,
    title: "Chat",
    body: "Grounded, direct answers with conversation memory once you sign in.",
  },
  {
    icon: Search,
    title: "Research",
    body: "Structured briefs with findings, evidence basis and stated uncertainty.",
  },
  {
    icon: BookOpen,
    title: "Sanatan Research",
    body: "Scholarly study of Indian texts with evidence clearly labelled.",
  },
  {
    icon: ImageIcon,
    title: "Image",
    body: "Prompt, aspect ratio and style controls with a real generation pipeline.",
  },
  {
    icon: Video,
    title: "Video",
    body: "Prompt-to-video jobs with live status, preview and retry.",
  },
  {
    icon: Mic,
    title: "Voice",
    body: "Speak to ACHYORA and read the transcript alongside the reply.",
  },
];

function Home() {
  useEffect(() => {
    track("landing_page_viewed");
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <main>
        {/* HERO — the composer is the product */}
        <section className="relative overflow-hidden">
          <AmbientSignature />
          <div className="relative mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pb-16 pt-12 sm:px-6 sm:pb-24 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:gap-14">
            <div>
              <div className="ach-rise">
                <p className="text-[0.66rem] uppercase tracking-[0.28em] text-muted-foreground">
                  Inspired by Timeless Wisdom. Built for Humanity.
                </p>
                <h1
                  className="ach-titanium-text mt-5 max-w-xl text-balance text-4xl leading-[1.06] sm:text-5xl"
                  style={{ fontWeight: 800 }}
                >
                  The AI platform from India.
                </h1>
                <p className="mt-4 max-w-md text-pretty text-sm text-muted-foreground sm:text-base">
                  Chat, research, image, video and voice — one place to think. Start below.
                </p>
              </div>

              <div className="ach-rise mt-8" style={{ animationDelay: "120ms" }}>
                <GuestChat />
              </div>
            </div>

            <div className="ach-rise order-first lg:order-none" style={{ animationDelay: "60ms" }}>
              <KrishnaFormation className="mx-auto aspect-square w-full max-w-[18rem] sm:max-w-sm lg:max-w-[30rem]" />
            </div>
          </div>
        </section>

        {/* CAPABILITIES */}
        <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <h2 className="text-2xl text-foreground sm:text-3xl" style={{ fontWeight: 700 }}>
            One platform, six ways to think
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Each surface is purpose-built rather than a chat window wearing a costume.
          </p>
          <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-card p-6">
                <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                <h3 className="mt-4 text-base text-foreground" style={{ fontWeight: 600 }}>
                  {title}
                </h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* SANATAN */}
        <section className="border-y border-border/60 bg-surface/40">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-[0.66rem] uppercase tracking-[0.24em] text-muted-foreground">
                A core ACHYORA difference
              </p>
              <h2 className="mt-4 text-2xl text-foreground sm:text-3xl" style={{ fontWeight: 700 }}>
                Sanatan Research, treated seriously
              </h2>
              <p className="mt-3 max-w-lg text-sm text-muted-foreground">
                Questions about the Vedas, Upanishads, Itihasa, Puranas and Indian philosophy
                deserve more than confident guessing. ACHYORA separates what a text states, what
                tradition holds, what historians debate and what remains uncertain — and never
                invents a citation.
              </p>
              <Link
                to="/sanatan"
                className="mt-6 inline-flex rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm text-secondary-foreground transition-colors hover:bg-accent"
                style={{ fontWeight: 600 }}
              >
                Explore Sanatan Research
              </Link>
            </div>
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {[
                "scriptural",
                "traditional",
                "historical",
                "archaeological",
                "scholarly",
                "interpretive",
                "disputed",
                "uncertain",
              ].map((label) => (
                <li
                  key={label}
                  className="rounded-xl border border-border bg-card px-4 py-3 text-sm capitalize text-muted-foreground"
                >
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* PRICING PREVIEW */}
        <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl text-foreground sm:text-3xl" style={{ fontWeight: 700 }}>
                Straightforward pricing
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                India and international pricing, no surprises.
              </p>
            </div>
            <Link to="/pricing" className="text-sm text-primary underline-offset-4 hover:underline">
              See full comparison
            </Link>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PLANS.map((plan) => (
              <div
                key={plan.id}
                className="rounded-2xl border border-border bg-card p-5"
                style={plan.highlight ? { borderColor: "var(--ring)" } : undefined}
              >
                <p className="text-sm text-muted-foreground">{plan.name}</p>
                <p className="mt-2 text-2xl text-foreground" style={{ fontWeight: 700 }}>
                  {plan.price.INR}
                  <span className="ml-1 text-sm text-muted-foreground">/ {plan.price.USD}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{plan.cadence}</p>
              </div>
            ))}
          </div>
        </section>

        {/* TRUST */}
        <section className="border-t border-border/60">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 className="text-2xl text-foreground sm:text-3xl" style={{ fontWeight: 700 }}>
              Responsible by construction
            </h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {[
                {
                  t: "No invented sources",
                  d: "Research and Sanatan answers state uncertainty instead of fabricating citations.",
                },
                {
                  t: "Keys stay server-side",
                  d: "Every model call runs on the server. The browser never sees a provider key.",
                },
                {
                  t: "Your data is yours",
                  d: "Conversations, files and media are scoped to your account at the database level.",
                },
              ].map((item) => (
                <div key={item.t} className="rounded-2xl border border-border bg-card p-6">
                  <h3 className="text-base text-foreground" style={{ fontWeight: 600 }}>
                    {item.t}
                  </h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{item.d}</p>
                </div>
              ))}
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link
                to="/auth"
                search={{ mode: "signup" }}
                className="rounded-xl bg-primary px-5 py-3 text-sm text-primary-foreground transition-opacity hover:opacity-90"
                style={{ fontWeight: 600 }}
              >
                Create your free account
              </Link>
              <Link
                to="/workspace"
                className="rounded-xl border border-border bg-secondary px-5 py-3 text-sm text-secondary-foreground transition-colors hover:bg-accent"
                style={{ fontWeight: 600 }}
              >
                Open the workspace
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
