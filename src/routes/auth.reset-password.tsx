import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { AchyoraWordmark } from "@/components/brand/AchyoraMark";
import { ErrorState } from "@/components/States";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set a new password — ACHYORA" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setDone(true);
    setTimeout(() => void navigate({ to: "/workspace" }), 900);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-14">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <AchyoraWordmark />
        </div>
        <div className="ach-glass rounded-2xl p-6 sm:p-7">
          <h1 className="text-xl text-foreground" style={{ fontWeight: 700 }}>
            Set a new password
          </h1>
          {error ? (
            <div className="mt-4">
              <ErrorState message={error} />
            </div>
          ) : null}
          {done ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Password updated. Taking you to the workspace…
            </p>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <label
                  htmlFor="new-password"
                  className="mb-1.5 block text-sm text-muted-foreground"
                >
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm text-primary-foreground disabled:opacity-50"
                style={{ fontWeight: 600 }}
              >
                {busy ? "Updating…" : "Update password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
