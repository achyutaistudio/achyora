import { createFileRoute, redirect } from "@tanstack/react-router";

// Alias kept so external deep links to /auth/sign-up keep working.
export const Route = createFileRoute("/auth/sign-up")({
  beforeLoad: () => {
    throw redirect({ to: "/auth", search: { mode: "signup" } });
  },
});
