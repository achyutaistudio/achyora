import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";

import { ErrorState, LoadingState } from "@/components/States";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { getAccount, getAiCatalog } from "@/lib/achyora.functions";

export const Route = createFileRoute("/workspace/overview")({
  head: () => ({
    meta: [
      { title: "Workspace — ACHYORA" },
      {
        name: "description",
        content:
          "Your ACHYORA workspace: credits, models and every creation surface.",
      },
      { property: "og:title", content: "Workspace — ACHYORA" },
      {
        property: "og:description",
        content: "Chat, research and create inside your ACHYORA workspace.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Overview,
});

const SURFACES = [
  {
    to: "/workspace/chat",
    title: "Chat",
    body: "Talk with ACHYORA across the models configured here.",
  },
  {
    to: "/workspace/research",
    title: "Research",
    body: "Evidence-first briefs with explicit uncertainty.",
  },
  {
    to: "/workspace/sanatan",
    title: "Sanatan Research",
    body: "Scholarly, respectful, source-classified answers.",
  },
  {
    to: "/workspace/image",
    title: "Image",
    body: "Generate images with the configured image provider.",
  },
  {
    to: "/workspace/video",
    title: "Video",
    body: "Queue a video generation job and track its status.",
  },
  {
    to: "/workspace/voice",
    title: "Voice",
    body: "Speak a prompt and get a spoken-style reply.",
  },
  {
    to: "/workspace/library",
    title: "Library",
    body: "Your private files, stored under your own account.",
  },
] as const;

function Overview() {
  const account = useServerFn(getAccount);
  const catalog = useServerFn(getAiCatalog);

  const accountQuery = useQuery({
    queryKey: ["account"],
    queryFn: () => account(),
  });
  const catalogQuery = useQuery({
    queryKey: ["ai-catalog"],
    queryFn: () => catalog(),
  });

  return (
    <WorkspacePage
      title="Overview"
      description="An internal snapshot of this account: credits, plan and configured models."
    >
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Credits
          </p>
          {accountQuery.isPending ? (
            <LoadingState label="Loading…" className="mt-3" />
          ) : accountQuery.isError ? (
            <p className="mt-2 text-sm text-muted-foreground">Unavailable</p>
          ) : (
            <>
              <p
                className="mt-2 text-3xl text-foreground"
                style={{ fontWeight: 700 }}
              >
                {accountQuery.data?.credits?.balance ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">
                of {accountQuery.data?.credits?.daily_allowance ?? 10} every 24
                hours
              </p>
            </>
          )}
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Plan
          </p>
          <p
            className="mt-2 text-lg text-foreground"
            style={{ fontWeight: 600 }}
          >
            {accountQuery.data?.subscription?.plan ?? "free"}
          </p>
          <p className="text-xs text-muted-foreground">
            {accountQuery.data?.subscription?.status ?? "inactive"}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Models available
          </p>
          <p
            className="mt-2 text-3xl text-foreground"
            style={{ fontWeight: 700 }}
          >
            {catalogQuery.data?.models.length ?? 0}
          </p>
          <p className="text-xs text-muted-foreground">
            {catalogQuery.data?.providers.join(", ") ||
              "No provider configured"}
          </p>
        </div>
      </div>

      {catalogQuery.data && catalogQuery.data.models.length === 0 ? (
        <div className="mt-6">
          <ErrorState
            code="AI_SERVICE_NOT_CONFIGURED"
            message="No AI provider credentials are configured on this deployment. Add a provider key to enable AI features."
          />
        </div>
      ) : null}

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {SURFACES.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className="rounded-2xl border border-border bg-card p-5 transition-colors hover:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="text-sm text-foreground" style={{ fontWeight: 600 }}>
              {s.title}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
          </Link>
        ))}
      </div>
    </WorkspacePage>
  );
}
