import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

import { LoadingState } from "@/components/States";
import { WorkspaceSidebar } from "@/components/workspace/WorkspaceSidebar";
import { useSession } from "@/hooks/useSession";
import { useCreditVisibility } from "@/hooks/useCreditVisibility";
import { waitForSession } from "@/lib/auth-session";
import { startAccountBootstrap } from "@/lib/account-bootstrap";
import { ensureAccountBootstrap } from "@/lib/account.functions";
import { getAccount } from "@/lib/achyora.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/workspace")({
  ssr: false,
  component: WorkspaceLayout,
});

const COLLAPSE_KEY = "achyora.sidebarCollapsed";

function CreditChip() {
  const accountFn = useServerFn(getAccount);
  const account = useQuery({ queryKey: ["account"], queryFn: () => accountFn() });
  const balance = account.data?.credits?.balance;
  if (balance === undefined || balance === null) return null;
  return (
    <span className="rounded-full border border-border/70 bg-secondary/50 px-3 py-1.5 text-xs text-muted-foreground">
      {balance} credits
    </span>
  );
}

function WorkspaceLayout() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const bootstrapAccount = useServerFn(ensureAccountBootstrap);
  const { user } = useSession();
  const { showCredits } = useCreditVisibility();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Preference read after hydration so server and client render the same tree.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* preference is best-effort only */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* preference is best-effort only */
      }
      return next;
    });
  }, []);

  // Unchanged authentication behaviour: "session still initializing" must never
  // be treated as "signed out". waitForSession only resolves null once the
  // client has actually settled without a session.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await waitForSession();
      if (cancelled) return;
      if (!session) {
        await navigate({ to: "/auth", search: { mode: "signin" }, replace: true });
        return;
      }
      // A valid session grants workspace access. Provisioning is idempotent but
      // deliberately non-blocking, bounded, and separate from authentication.
      setReady(true);
      startAccountBootstrap(bootstrapAccount);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, bootstrapAccount]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Desktop rail — the single navigation surface. */}
      <aside
        className={cn(
          "hidden shrink-0 transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:block",
          collapsed ? "w-[4.5rem]" : "w-64",
        )}
      >
        <WorkspaceSidebar collapsed={collapsed} onToggle={toggleCollapsed} user={user} />
      </aside>

      {/* Mobile drawer — same component, no duplicate navigation model. */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 w-64 shadow-[0_0_80px_-20px_rgba(0,0,0,0.9)]">
            <WorkspaceSidebar
              collapsed={false}
              onToggle={toggleCollapsed}
              user={user}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/50 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground lg:hidden"
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>

          <div className="ml-auto flex items-center gap-2">
            {ready && showCredits ? <CreditChip /> : null}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          {ready ? (
            <Outlet />
          ) : (
            <div className="p-6 sm:p-8">
              <LoadingState label="Opening your workspace…" />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
