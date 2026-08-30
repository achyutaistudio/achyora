import { createFileRoute, redirect } from "@tanstack/react-router";

// Alias kept so external deep links to /dashboard keep working.
export const Route = createFileRoute("/dashboard")({
  beforeLoad: () => {
    throw redirect({ to: "/workspace" });
  },
});
