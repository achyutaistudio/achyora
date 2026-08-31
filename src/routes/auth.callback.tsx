import { createFileRoute } from "@tanstack/react-router";

import { createSupabaseServerClient } from "@/integrations/supabase/server-client";

/**
 * OAuth / email-confirmation callback — SERVER ONLY.
 *
 * The browser lands here after Google with `?code=...`. This handler performs
 * exactly ONE `exchangeCodeForSession(code)` on the server, writes the session
 * into @supabase/ssr cookies, and 302-redirects. There is no React component
 * and no client-side auth listener, so the "Completing sign-in…" spinner can
 * never hang: the user always leaves /auth/callback with either a session or a
 * visible error on the sign-in page.
 */

/** Only same-origin, relative paths are accepted as a redirect destination. */
function safeNext(raw: string | null): string {
  if (!raw) return "/workspace";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\"))
    return "/workspace";
  // Never bounce back into the callback or the sign-in form.
  const path = raw.split("?")[0];
  if (path === "/auth" || path === "/auth/" || path === "/auth/callback")
    return "/workspace";
  return raw;
}

function redirectTo(
  location: string,
  setCookieHeaders: string[] = [],
): Response {
  const headers = new Headers({ location });
  for (const cookie of setCookieHeaders) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function failure(request: Request, reason: string): Response {
  // Always visible in dev logs so callback failures are diagnosable.
  console.error(
    "[auth/callback] sign-in failed:",
    reason,
    new URL(request.url).search,
  );
  const params = new URLSearchParams({ mode: "signin", auth_error: reason });
  return redirectTo(`/auth?${params.toString()}`);
}

export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const next = safeNext(url.searchParams.get("next"));

        // Supabase can return a provider error instead of a code.
        const providerError =
          url.searchParams.get("error_description") ??
          url.searchParams.get("error");
        if (providerError) return failure(request, providerError);

        const code = url.searchParams.get("code");
        if (!code) {
          return failure(
            request,
            "No authorization code was returned by Google.",
          );
        }

        let supabase: ReturnType<typeof createSupabaseServerClient>;
        try {
          supabase = createSupabaseServerClient(request);
        } catch (err) {
          return failure(
            request,
            err instanceof Error ? err.message : "Supabase is not configured.",
          );
        }

        const { data, error } =
          await supabase.client.auth.exchangeCodeForSession(code);

        if (error || !data?.session) {
          return failure(
            request,
            error?.message ??
              "The sign-in code could not be exchanged for a session.",
          );
        }

        return redirectTo(next, supabase.setCookieHeaders);
      },
    },
  },
});
