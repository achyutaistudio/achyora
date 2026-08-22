import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

/**
 * Resolve the browser session without ever allowing auth initialization to
 * leave a route stuck on a loading screen.
 *
 * Supabase restores its persisted session asynchronously. Both getSession()
 * and the first auth-state event can be delayed by browser storage, a
 * network refresh, or a private-window storage policy. Every wait below is
 * therefore bounded. A timeout means "not ready yet" rather than an endless
 * spinner; the callback route can then show a recoverable error.
 */
export async function waitForSession(timeoutMs = 4000): Promise<Session | null> {
  const bounded = <T>(promise: Promise<T>, ms: number): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("AUTH_TIMEOUT")), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });

  // First try the already-restored session, but never let this call block the
  // page indefinitely.
  try {
    const { data } = await bounded(supabase.auth.getSession(), Math.min(timeoutMs, 4000));
    if (data.session) return data.session;
  } catch {
    // Fall through to the auth-state listener. This is intentionally quiet;
    // the callback route decides whether a missing session is recoverable.
  }

  return new Promise<Session | null>((resolve) => {
    let settled = false;
    // eslint-disable-next-line prefer-const
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;

    const finish = (session: Session | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unsubscribe?.();
      resolve(session);
    };

    try {
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (session) {
          finish(session);
          return;
        }

        // Supabase has finished restoring auth and confirmed that there is no
        // persisted session.
        if (event === "INITIAL_SESSION" || event === "SIGNED_OUT") {
          finish(null);
        }
      });
      unsubscribe = data.subscription.unsubscribe;
    } catch {
      finish(null);
      return;
    }

    timer = setTimeout(() => {
      // One final bounded read catches a session that was established just as
      // the listener timed out, without ever hanging the UI.
      void bounded(supabase.auth.getSession(), 1500)
        .then(({ data }) => finish(data.session ?? null))
        .catch(() => finish(null));
    }, timeoutMs);
  });
}
