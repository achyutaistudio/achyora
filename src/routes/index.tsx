import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { ArrowRight, Sparkles } from "lucide-react";

import { GuestChat } from "@/components/GuestChat";
import { KrishnaFormation } from "@/components/KrishnaFormation";
import { SiteHeader } from "@/components/SiteChrome";
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

function Home() {
  useEffect(() => {
    track("landing_page_viewed");
  }, []);

  return (
    <div className="landing-cinema relative isolate min-h-svh overflow-hidden bg-background">
      <div className="landing-cinema__visual" aria-hidden="true">
        <KrishnaFormation className="absolute inset-0 h-full w-full" />
      </div>
      <div className="landing-cinema__veil" aria-hidden="true" />
      <SiteHeader overlay />

      <main className="relative z-10 flex min-h-[calc(100svh-4rem)] items-center justify-center px-4 py-12 sm:px-6">
        <section className="w-full max-w-3xl text-center">
          <div className="ach-rise">
            <p className="text-[0.65rem] uppercase tracking-[0.34em] text-white/60">
              Inspired by timeless wisdom
            </p>
            <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.045em] text-white sm:text-6xl lg:text-7xl">
              Ask for anything.
              <span className="block text-white/55">Make it meaningful.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-lg text-pretty text-sm leading-6 text-white/65 sm:text-base">
              One quiet place for thinking, researching and creating with AI.
            </p>
          </div>

          <div className="ach-rise mx-auto mt-9 max-w-2xl text-left" style={{ animationDelay: "120ms" }}>
            <GuestChat />
          </div>

          <div className="ach-rise mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-white/50" style={{ animationDelay: "180ms" }}>
            <span className="inline-flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Chat, research, create</span>
            <Link to="/sanatan" className="inline-flex items-center gap-1.5 transition-colors hover:text-white">
              Explore Sanatan <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </section>
      </main>

      <div className="pointer-events-none absolute bottom-5 left-0 right-0 z-10 flex justify-center px-4">
        <p className="text-[0.62rem] uppercase tracking-[0.28em] text-white/35">
          A calm interface for a curious mind
        </p>
      </div>
    </div>
  );
}
