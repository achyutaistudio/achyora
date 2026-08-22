import { createFileRoute, redirect } from "@tanstack/react-router";

// Alias kept so external deep links to /auth/sign-in keep working.
export const Route = createFileRoute("/auth/sign-in")({
  beforeLoad: () => {
    throw redirect({ to: "/auth", search: { mode: "signin" } });
  },
});
