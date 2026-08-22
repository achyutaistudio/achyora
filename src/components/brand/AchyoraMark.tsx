import { Link } from "@tanstack/react-router";

import { cn } from "@/lib/utils";

export function AchyoraMark({ className }: { className?: string }) {
  return (
    <img
      src="/brand/achyora-icon.png"
      alt=""
      aria-hidden="true"
      width={40}
      height={40}
      className={cn("h-9 w-9 rounded-xl", className)}
    />
  );
}

export function AchyoraWordmark({
  className,
  to = "/",
  subtitle,
}: {
  className?: string;
  to?: string;
  subtitle?: string;
}) {
  return (
    <Link
      to={to}
      className={cn("group inline-flex items-center gap-3 rounded-xl", className)}
      aria-label="ACHYORA home"
    >
      <AchyoraMark />
      <span className="flex flex-col leading-none">
        <span
          className="ach-titanium-text text-[1.05rem] font-800 tracking-[0.22em]"
          style={{ fontWeight: 800 }}
        >
          ACHYORA
        </span>
        {subtitle ? (
          <span className="mt-1 text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
