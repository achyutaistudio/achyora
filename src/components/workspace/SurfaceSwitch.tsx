import { Link, useRouterState } from "@tanstack/react-router";

import { cn } from "@/lib/utils";

const OPTIONS = [
  { to: "/workspace/chat", label: "Chat" },
  { to: "/workspace/sanatan", label: "Sanatan" },
] as const;

/**
 * The one primary mode switch in the top bar. Each side simply routes to the
 * existing surface — no parallel state, no duplicated experience.
 */
export function SurfaceSwitch() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div
      role="tablist"
      aria-label="Workspace mode"
      className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-secondary/50 p-1"
    >
      {OPTIONS.map((o) => {
        const active = pathname === o.to || pathname.startsWith(`${o.to}/`);
        return (
          <Link
            key={o.to}
            to={o.to}
            role="tab"
            aria-selected={active}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm transition-colors",
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
            style={active ? { fontWeight: 600 } : undefined}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}
