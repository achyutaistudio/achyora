import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, X } from "lucide-react";

import { AchyoraWordmark } from "@/components/brand/AchyoraMark";
import { UserMenu } from "@/components/UserMenu";
import { useSession } from "@/hooks/useSession";
import { cn } from "@/lib/utils";

const LINKS = [
  { to: "/pricing", label: "Pricing" },
  { to: "/sanatan", label: "Sanatan Research" },
] as const;

export function SiteHeader({ overlay = false }: { overlay?: boolean }) {
  const { user, loading } = useSession();
  const [open, setOpen] = useState(false);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b backdrop-blur-xl",
        overlay
          ? "border-white/10 bg-[#080b15]/35 text-white backdrop-blur-md"
          : "border-border/60 bg-background/80",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <AchyoraWordmark />

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              activeProps={{ className: "text-foreground" }}
            >
              {l.label}
            </Link>
          ))}
          {loading ? null : user ? (
            <>
              <Link
                to="/workspace"
                className="ml-2 rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90"
                style={{ fontWeight: 600 }}
              >
                Open workspace
              </Link>
              {/* Real authenticated identity: avatar/name/email come from the
                  Supabase session, never from hardcoded values. */}
              <UserMenu user={user} />
            </>
          ) : (
            <>
              <Link
                to="/auth"
                search={{ mode: "signin" }}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Sign in
              </Link>
              <Link
                to="/auth"
                search={{ mode: "signup" }}
                className="ml-1 rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90"
                style={{ fontWeight: 600 }}
              >
                Create account
              </Link>
            </>
          )}
        </nav>

        <div className="flex items-center gap-1 md:hidden">
          {loading ? null : user ? <UserMenu user={user} /> : null}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className={cn(
              "inline-flex h-10 w-10 items-center justify-center rounded-xl border",
              overlay ? "border-white/15 bg-white/5" : "border-border",
            )}
          >
            {open ? (
              <X className="h-4.5 w-4.5" />
            ) : (
              <Menu className="h-4.5 w-4.5" />
            )}
          </button>
        </div>
      </div>

      {open ? (
        <div
          className={cn(
            "border-t md:hidden",
            overlay
              ? "border-white/10 bg-[#080b15]/90"
              : "border-border/60 bg-background",
          )}
        >
          <nav
            className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-4"
            aria-label="Mobile"
          >
            {LINKS.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm text-muted-foreground"
              >
                {l.label}
              </Link>
            ))}
            {user ? (
              <>
                <Link
                  to="/workspace"
                  onClick={() => setOpen(false)}
                  className="mt-1 rounded-xl bg-primary px-4 py-2.5 text-center text-sm text-primary-foreground"
                  style={{ fontWeight: 600 }}
                >
                  Open workspace
                </Link>
                <Link
                  to="/workspace/settings"
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm text-muted-foreground"
                >
                  Settings
                </Link>
                <p className="truncate px-3 pt-2 text-xs text-muted-foreground">
                  Signed in as {user.email}
                </p>
              </>
            ) : (
              <>
                <Link
                  to="/auth"
                  search={{ mode: "signin" }}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm text-muted-foreground"
                >
                  Sign in
                </Link>
                <Link
                  to="/auth"
                  search={{ mode: "signup" }}
                  onClick={() => setOpen(false)}
                  className="mt-1 rounded-xl bg-primary px-4 py-2.5 text-center text-sm text-primary-foreground"
                  style={{ fontWeight: 600 }}
                >
                  Create account
                </Link>
              </>
            )}
          </nav>
        </div>
      ) : null}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <AchyoraWordmark subtitle="Inspired by Timeless Wisdom. Built for Humanity." />
        </div>
        <nav
          className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground"
          aria-label="Footer"
        >
          <Link
            to="/pricing"
            className="transition-colors hover:text-foreground"
          >
            Pricing
          </Link>
          <Link
            to="/sanatan"
            className="transition-colors hover:text-foreground"
          >
            Sanatan Research
          </Link>
          <Link
            to="/responsible-ai"
            className="transition-colors hover:text-foreground"
          >
            Responsible AI
          </Link>
          <Link
            to="/auth"
            search={{ mode: "signin" }}
            className="transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
        </nav>
      </div>
      <p className="mx-auto mt-8 w-full max-w-6xl px-4 text-xs text-muted-foreground sm:px-6">
        © {new Date().getFullYear()} ACHYORA. An independent Indian-origin AI
        platform.
      </p>
    </footer>
  );
}
