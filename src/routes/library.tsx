import { createFileRoute, redirect } from "@tanstack/react-router";

// Alias kept so external deep links to /library keep working.
export const Route = createFileRoute("/library")({
  beforeLoad: () => {
    throw redirect({ to: "/workspace/library" });
  },
});
