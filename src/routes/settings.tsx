import { createFileRoute, redirect } from "@tanstack/react-router";

// Alias kept so external deep links to /settings keep working.
export const Route = createFileRoute("/settings")({
  beforeLoad: () => {
    throw redirect({ to: "/workspace/settings" });
  },
});
