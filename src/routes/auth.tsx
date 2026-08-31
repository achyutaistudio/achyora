import { createFileRoute, Outlet } from "@tanstack/react-router";

type Mode = "signin" | "signup" | "reset";

/**
 * Layout route for /auth/*.
 *
 * It renders ONLY the outlet. The sign-in UI lives in the /auth/ index route
 * (src/routes/auth.index.tsx) so the sign-in form can never render on top of
 * /auth/callback, and so this component never changes its hook order between
 * pathnames.
 */
export const Route = createFileRoute("/auth")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { mode?: Mode; auth_error?: string; next?: string } => {
    const mode = search["mode"];
    const authError = search["auth_error"];
    const next = search["next"];
    return {
      ...(mode === "signup" || mode === "reset" || mode === "signin"
        ? { mode }
        : {}),
      // Surfaced by the server /auth/callback route when sign-in fails.
      ...(typeof authError === "string" && authError
        ? { auth_error: authError }
        : {}),
      ...(typeof next === "string" &&
      next.startsWith("/") &&
      !next.startsWith("//")
        ? { next }
        : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "Sign in — ACHYORA" },
      {
        name: "description",
        content:
          "Sign in or create your free ACHYORA account to save conversations and open the workspace.",
      },
      { property: "og:title", content: "Sign in — ACHYORA" },
      {
        property: "og:description",
        content:
          "Create a free ACHYORA account to keep chatting and unlock the workspace.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <Outlet />,
});
