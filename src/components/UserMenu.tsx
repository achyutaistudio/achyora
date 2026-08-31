import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { LogOut, Settings as SettingsIcon, Sparkles } from "lucide-react";
import type { User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

function initials(user: User): string {
  const name =
    (user.user_metadata?.["full_name"] as string | undefined) ??
    user.email ??
    "";
  const parts = name
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]!.toUpperCase());
  return letters.join("") || "A";
}

function displayName(user: User): string {
  return (
    (user.user_metadata?.["full_name"] as string | undefined) ??
    (user.user_metadata?.["name"] as string | undefined) ??
    user.email ??
    "Your account"
  );
}

/** Signed-in identity + sign-out, available from every page header. */
export function UserMenu({ user }: { user: User }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    setBusy(true);
    try {
      // Clear local state even if the network call fails, so the UI can never
      // get stuck in a "signed in but no session" state.
      await supabase.auth.signOut().catch(() => undefined);
    } finally {
      setBusy(false);
      setOpen(false);
      await navigate({ to: "/", replace: true });
    }
  }

  const avatarUrl = user.user_metadata?.["avatar_url"] as string | undefined;

  return (
    <div className="relative ml-2" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-2 py-1.5 text-sm text-secondary-foreground transition-colors hover:bg-accent"
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            width={28}
            height={28}
            referrerPolicy="no-referrer"
            className="h-7 w-7 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[0.7rem] text-primary-foreground"
            style={{ fontWeight: 700 }}
          >
            {initials(user)}
          </span>
        )}
        <span className="hidden max-w-[10rem] truncate md:inline">
          {displayName(user)}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-background shadow-lg"
        >
          <div className="border-b border-border px-3 py-3">
            <p
              className="truncate text-sm text-foreground"
              style={{ fontWeight: 600 }}
            >
              {displayName(user)}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {user.email}
            </p>
          </div>
          <Link
            to="/workspace"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-accent"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Open workspace
          </Link>
          <Link
            to="/workspace/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-accent"
          >
            <SettingsIcon className="h-4 w-4" aria-hidden="true" />
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
