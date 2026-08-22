import { createFileRoute, redirect } from "@tanstack/react-router";

// Alias kept so external deep links to /chat keep working.
export const Route = createFileRoute("/chat")({
  beforeLoad: () => {
    throw redirect({ to: "/workspace/chat" });
  },
});
