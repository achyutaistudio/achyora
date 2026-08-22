import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The workspace root is Chat.
 *
 * A signed-in user lands here from the existing auth callback and is sent
 * straight to the Chat surface — the Overview snapshot still exists at
 * /workspace/overview for internal use. This is a pure route-level redirect:
 * it runs after the parent /workspace layout has already resolved the session,
 * so it cannot introduce an auth redirect loop.
 */
export const Route = createFileRoute("/workspace/")({
  beforeLoad: () => {
    throw redirect({ to: "/workspace/chat", replace: true });
  },
});
