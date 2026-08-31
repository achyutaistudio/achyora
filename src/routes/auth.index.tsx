import {
  createFileRoute,
  Link,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { AchyoraWordmark } from "@/components/brand/AchyoraMark";
import { AmbientSignature } from "@/components/AmbientSignature";
import { ErrorState } from "@/components/States";
import { supabase } from "@/integrations/supabase/client";
import { waitForSession } from "@/lib/auth-session";
import { track } from "@/lib/analytics";
import { useHydrated } from "@/hooks/useHydrated";

type Mode = "signin" | "signup" | "reset";

export const Route = createFileRoute("/auth/")({
  component: AuthPage,
});

function AuthPage() {
  const search = useSearch({ from: "/auth" });
  const navigate = useNavigate();
  // Until React has hydrated, the form/buttons are inert markup: a click would
  // trigger a native GET submit ("/auth?") that never creates a session.
  const hydrated = useHydrated();
  const [mode, setMode] = useState<Mode>(search.mode ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // A failed server-side callback redirects here with ?auth_error=..., so the
  // real Supabase error is shown instead of an endless spinner.
  const [error, setError] = useState<string | null>(search.auth_error ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  // Guards a single OAuth redirect per click, even on double-click.
  const oauthStarted = useRef(false);

  // A signed-in user should never sit on the sign-in form. This waits for the
  // client to finish restoring the session before deciding, so it can never
  // fight the OAuth callback.
  useEffect(() => {
    let cancelled = false;
    void waitForSession().then((session) => {
      if (!cancelled && session)
        void navigate({ to: "/workspace", replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!hydrated) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "reset") {
        // Recovery links now go through the server callback (PKCE code
        // exchange), which then forwards to the reset form with a session.
        const { error: err } = await supabase.auth.resetPasswordForEmail(
          email,
          {
            redirectTo: `${window.location.origin}/auth/callback?next=%2Fauth%2Freset-password`,
          },
        );
        if (err) throw err;
        setNotice(
          "If that address has an account, a reset link is on its way.",
        );
      } else if (mode === "signup") {
        track("sign_up_started");
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (err) throw err;
        if (data.session) {
          track("sign_up_completed");
          await navigate({ to: "/workspace" });
        } else {
          setNotice("Check your email to confirm your account, then sign in.");
        }
      } else {
        track("sign_in_started");
        const { error: err } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (err) throw err;
        track("sign_in_completed");
        await navigate({ to: "/workspace" });
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn't complete that. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    if (!hydrated) return;
    // Exactly one signInWithOAuth per click: a second call would mint a second
    // PKCE verifier and overwrite the first, invalidating the flow state.
    if (oauthStarted.current) return;
    oauthStarted.current = true;
    setError(null);
    setBusy(true);
    track("google_sign_in");
    // Own Supabase Auth Google provider — no external OAuth broker, no manually
    // constructed Google URL. supabase-js stores the PKCE verifier in a cookie
    // and we never touch it; the server /auth/callback route exchanges the code
    // exactly once. The origin comes from the browser, never hard-coded.
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    if (search.next) callbackUrl.searchParams.set("next", search.next);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl.toString() },
    });
    if (err) {
      oauthStarted.current = false;
      setError("Google sign-in could not be started. Please try again.");
      setBusy(false);
      return;
    }
    // The browser is on its way to Google; /auth/callback finishes up.
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-14">
      <AmbientSignature />
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <AchyoraWordmark />
        </div>
        <div className="ach-glass rounded-2xl p-6 sm:p-7">
          <h1 className="text-xl text-foreground" style={{ fontWeight: 700 }}>
            {mode === "signup"
              ? "Create your account"
              : mode === "reset"
                ? "Reset your password"
                : "Welcome back"}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {mode === "signup"
              ? "Free daily credits, saved conversations and the full workspace."
              : mode === "reset"
                ? "We'll email you a secure link to set a new password."
                : "Continue your conversations with ACHYORA."}
          </p>

          {error ? (
            <div className="mt-4">
              <ErrorState message={error} />
            </div>
          ) : null}
          {notice ? (
            <p className="mt-4 rounded-xl border border-border bg-secondary px-4 py-3 text-sm text-secondary-foreground">
              {notice}
            </p>
          ) : null}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-sm text-muted-foreground"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                placeholder="you@example.com"
              />
            </div>
            {mode !== "reset" ? (
              <div>
                <label
                  htmlFor="password"
                  className="mb-1.5 block text-sm text-muted-foreground"
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none"
                  placeholder="At least 8 characters"
                />
              </div>
            ) : null}
            <button
              type="submit"
              disabled={busy || !hydrated}
              className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ fontWeight: 600 }}
            >
              {busy
                ? "Please wait…"
                : mode === "signup"
                  ? "Create account"
                  : mode === "reset"
                    ? "Send reset link"
                    : "Sign in"}
            </button>
          </form>

          {mode !== "reset" ? (
            <>
              <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>
              <button
                type="button"
                onClick={google}
                disabled={busy || !hydrated}
                className="w-full rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm text-secondary-foreground transition-colors hover:bg-accent disabled:opacity-50"
                style={{ fontWeight: 600 }}
              >
                Continue with Google
              </button>
            </>
          ) : null}

          <div className="mt-6 flex flex-wrap justify-between gap-2 text-sm">
            {mode !== "signup" ? (
              <button
                type="button"
                onClick={() => setMode("signup")}
                className="text-primary hover:underline"
              >
                Create an account
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setMode("signin")}
                className="text-primary hover:underline"
              >
                I already have an account
              </button>
            )}
            {mode !== "reset" ? (
              <button
                type="button"
                onClick={() => setMode("reset")}
                className="text-muted-foreground hover:text-foreground"
              >
                Forgot password?
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setMode("signin")}
                className="text-muted-foreground hover:text-foreground"
              >
                Back to sign in
              </button>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            Back to ACHYORA
          </Link>
        </p>
      </div>
    </div>
  );
}
