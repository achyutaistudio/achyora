import { useEffect, useState } from "react";

/**
 * ACHYORA ambient signature.
 *
 * An abstract, non-literal visual: slow cosmic orbits, a flute-like flowing
 * wave, a restrained feather-curve arc and a soft moonlit aura. No depiction
 * of any person or deity. Pure CSS/SVG — no images, no video, no libraries.
 *
 * Intensity degrades automatically: desktop > tablet > mobile, and reduced
 * motion or low-core devices fall back to a static ambient gradient.
 */

type Intensity = "full" | "reduced" | "minimal" | "static";

function useIntensity(): Intensity {
  const [intensity, setIntensity] = useState<Intensity>("static");

  useEffect(() => {
    const compute = () => {
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (reduced) return "static" as const;
      const cores = navigator.hardwareConcurrency ?? 4;
      if (cores <= 2) return "static" as const;
      const w = window.innerWidth;
      if (w < 768) return "minimal" as const;
      if (w < 1280) return "reduced" as const;
      return "full" as const;
    };
    const apply = () => setIntensity(compute());
    apply();
    window.addEventListener("resize", apply, { passive: true });
    return () => window.removeEventListener("resize", apply);
  }, []);

  return intensity;
}

export function AmbientSignature() {
  const intensity = useIntensity();
  const animate = intensity !== "static";
  const showOrbits = intensity === "full" || intensity === "reduced";
  const showParticles = intensity === "full";

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* moonlit aura */}
      <div
        className="absolute left-1/2 top-[18%] h-[46rem] w-[46rem] -translate-x-1/2 -translate-y-1/3 rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--ice) 26%, transparent) 0%, color-mix(in oklab, var(--ice) 8%, transparent) 42%, transparent 70%)",
          animation: animate
            ? "ach-breathe 14s ease-in-out infinite"
            : undefined,
        }}
      />
      <div
        className="absolute -left-40 bottom-[-12rem] h-[34rem] w-[34rem] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--surface-strong) 80%, transparent) 0%, transparent 68%)",
          animation: animate ? "ach-drift 26s ease-in-out infinite" : undefined,
        }}
      />

      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
        role="presentation"
      >
        <defs>
          <linearGradient id="ach-wave" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--ice)" stopOpacity="0" />
            <stop offset="45%" stopColor="var(--ice)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--titanium)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="ach-arc" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--titanium)" stopOpacity="0.05" />
            <stop offset="60%" stopColor="var(--ice)" stopOpacity="0.22" />
            <stop
              offset="100%"
              stopColor="var(--titanium)"
              stopOpacity="0.03"
            />
          </linearGradient>
        </defs>

        {showOrbits ? (
          <g
            style={{
              transformOrigin: "600px 340px",
              animation: animate ? "ach-orbit 120s linear infinite" : undefined,
            }}
          >
            <ellipse
              cx="600"
              cy="340"
              rx="420"
              ry="150"
              fill="none"
              stroke="url(#ach-arc)"
              strokeWidth="1"
              opacity="0.55"
            />
            <ellipse
              cx="600"
              cy="340"
              rx="300"
              ry="300"
              fill="none"
              stroke="url(#ach-arc)"
              strokeWidth="0.7"
              opacity="0.3"
            />
          </g>
        ) : null}

        {/* flute-like flowing wave — the breath line */}
        <path
          d="M-200 470 C 100 400, 240 540, 520 470 S 940 400, 1400 470"
          fill="none"
          stroke="url(#ach-wave)"
          strokeWidth="1.4"
          strokeDasharray="18 26"
          style={{
            animation: animate
              ? "ach-flute-wave 34s linear infinite"
              : undefined,
          }}
        />
        <path
          d="M-200 528 C 160 470, 300 600, 600 528 S 1000 460, 1400 528"
          fill="none"
          stroke="url(#ach-wave)"
          strokeWidth="0.9"
          strokeDasharray="10 34"
          opacity="0.6"
          style={{
            animation: animate
              ? "ach-flute-wave 52s linear infinite reverse"
              : undefined,
          }}
        />

        {/* restrained feather curvature */}
        {showOrbits ? (
          <path
            d="M180 700 C 300 470, 520 360, 700 330"
            fill="none"
            stroke="url(#ach-arc)"
            strokeWidth="26"
            strokeLinecap="round"
            opacity="0.10"
            style={{
              animation: animate
                ? "ach-drift 30s ease-in-out infinite"
                : undefined,
            }}
          />
        ) : null}

        {showParticles
          ? Array.from({ length: 16 }).map((_, i) => (
              <circle
                key={i}
                cx={80 + ((i * 137) % 1040)}
                cy={120 + ((i * 211) % 560)}
                r={i % 3 === 0 ? 1.6 : 1}
                fill="var(--ice)"
                opacity="0.35"
                style={{
                  animation: `ach-breathe ${9 + (i % 7) * 2}s ease-in-out ${i * 0.4}s infinite`,
                }}
              />
            ))
          : null}
      </svg>

      {/* keep the interface dominant */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in oklab, var(--background) 30%, transparent) 0%, transparent 35%, color-mix(in oklab, var(--background) 78%, transparent) 100%)",
        }}
      />
    </div>
  );
}
