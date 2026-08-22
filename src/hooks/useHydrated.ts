import { useEffect, useState } from "react";

/**
 * True only after React has hydrated on the client.
 *
 * Server-rendered markup is interactive-looking but inert until hydration
 * finishes. Without this, a click on a form's submit button performs a *native*
 * browser submission (GET /auth?), which never creates a session and makes the
 * button look broken. Gating the buttons on real hydration state — not a timer —
 * removes that window entirely.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated;
}
