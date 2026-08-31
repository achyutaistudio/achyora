import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared padding, measure and heading rhythm for every workspace surface, so
 * pages stay visually consistent without repeating layout in each route.
 */
export function WorkspacePage({
  title,
  description,
  actions,
  children,
  width = "reading",
  className,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  width?: "reading" | "wide" | "full";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "workspace-page mx-auto w-full px-4 py-8 sm:px-8 sm:py-10",
        width === "reading"
          ? "max-w-3xl"
          : width === "wide"
            ? "max-w-6xl"
            : "max-w-none",
        className,
      )}
    >
      {title ? (
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1
              className="text-[1.35rem] text-foreground"
              style={{ fontWeight: 650 }}
            >
              {title}
            </h1>
            {description ? (
              <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex items-center gap-2">{actions}</div>
          ) : null}
        </header>
      ) : null}
      {children}
    </div>
  );
}
