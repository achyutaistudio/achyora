import { useEffect, useRef } from "react";

import maskUrl from "@/assets/achyora-form-mask.png";

/**
 * ACHYORA hero formation.
 *
 * A live generative build: light fragments drift, then move with intent and
 * gradually resolve into a Shri Krishna–inspired form, which stays subtly
 * alive afterwards. Nothing is a static picture — the silhouette PNG is only
 * sampled offscreen for target coordinates and is never drawn to screen.
 *
 * Performance contract:
 *  - single canvas, single rAF loop, cancelled on unmount
 *  - paused when offscreen or when the tab is hidden
 *  - particle budget scales with viewport width and device cores
 *  - prefers-reduced-motion / low-power devices render the resolved form once
 */

type Particle = {
  tx: number;
  ty: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  delay: number;
  dur: number;
  size: number;
  phase: number;
  drift: number;
};

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function readColor(el: HTMLElement, name: string, fallback: string) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v.length > 0 ? v : fallback;
}

export function KrishnaFormation({ className }: { className?: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cores = navigator.hardwareConcurrency ?? 4;
    const lowPower = cores <= 2;
    const still = reduced || lowPower;

    let frame = 0;
    let disposed = false;
    let visible = true;
    let particles: Particle[] = [];
    let width = 0;
    let height = 0;
    let start = 0;

    const dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1.5 : 2);
    const ice = readColor(wrap, "--ice", "oklch(0.83 0.098 232)");
    const titanium = readColor(wrap, "--titanium", "oklch(0.88 0.008 250)");

    const budget = () => {
      const w = window.innerWidth;
      if (w < 480) return 700;
      if (w < 768) return 1100;
      if (w < 1280) return 1900;
      return 2800;
    };

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      width = Math.max(rect.width, 1);
      height = Math.max(rect.height, 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const buildParticles = (points: Array<[number, number]>) => {
      const target = budget();
      const step = Math.max(1, Math.floor(points.length / target));
      const picked: Array<[number, number]> = [];
      for (let i = 0; i < points.length; i += step) picked.push(points[i]!);

      // Fit the form inside the canvas, keeping generous whitespace.
      const scale = Math.min(width / 1.35, height) / 512;
      const ox = width / 2 - (512 * scale) / 2;
      const oy = height / 2 - (512 * scale) / 2;

      particles = picked.map(([px, py], i) => {
        const tx = ox + px * scale;
        const ty = oy + py * scale;
        const angle = (i / picked.length) * Math.PI * 2 + Math.random() * 0.6;
        const radius = Math.max(width, height) * (0.35 + Math.random() * 0.5);
        return {
          tx,
          ty,
          sx: width / 2 + Math.cos(angle) * radius,
          sy: height / 2 + Math.sin(angle) * radius * 0.55,
          x: 0,
          y: 0,
          delay: 400 + Math.random() * 2200 + (py / 512) * 1100,
          dur: 2200 + Math.random() * 1600,
          size: Math.random() < 0.16 ? 1.6 : 1.05,
          phase: Math.random() * Math.PI * 2,
          drift: 0.6 + Math.random() * 1.6,
        };
      });
      for (const p of particles) {
        p.x = p.sx;
        p.y = p.sy;
      }
    };

    const draw = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";

      for (const p of particles) {
        let progress = still ? 1 : (t - p.delay) / p.dur;
        progress = progress <= 0 ? 0 : progress >= 1 ? 1 : easeInOut(progress);

        const settled = progress === 1;
        const wobble = settled && !still ? Math.sin(now / 1400 + p.phase) * p.drift : 0;
        const wobbleY = settled && !still ? Math.cos(now / 1700 + p.phase) * p.drift * 0.7 : 0;

        const x = p.sx + (p.tx - p.sx) * progress + wobble;
        const y = p.sy + (p.ty - p.sy) * progress + wobbleY;

        const alpha = still ? 0.62 : 0.18 + progress * 0.55;
        ctx.fillStyle = p.size > 1.2 ? titanium : ice;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    };

    const loop = (now: number) => {
      if (disposed) return;
      draw(now);
      frame = requestAnimationFrame(loop);
    };

    const startLoop = () => {
      if (disposed || frame !== 0) return;
      frame = requestAnimationFrame(loop);
    };
    const stopLoop = () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
    };

    const onResize = () => {
      resize();
      if (sampled) buildParticles(sampled);
      if (still) draw(performance.now());
    };

    const onVisibility = () => {
      if (document.hidden || !visible) stopLoop();
      else if (!still) startLoop();
    };

    let sampled: Array<[number, number]> | null = null;

    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        onVisibility();
      },
      { threshold: 0 },
    );

    const image = new Image();
    image.decoding = "async";
    image.src = maskUrl;

    const boot = () => {
      if (disposed) return;
      const off = document.createElement("canvas");
      off.width = 512;
      off.height = 512;
      const octx = off.getContext("2d", { willReadFrequently: true });
      if (!octx) return;
      octx.drawImage(image, 0, 0, 512, 512);
      const data = octx.getImageData(0, 0, 512, 512).data;
      const points: Array<[number, number]> = [];
      for (let y = 0; y < 512; y += 2) {
        for (let x = 0; x < 512; x += 2) {
          const i = (y * 512 + x) * 4;
          // dark pixels of the mask describe the form
          if ((data[i] ?? 255) < 110 && (data[i + 3] ?? 0) > 10) points.push([x, y]);
        }
      }
      if (points.length === 0) return;
      sampled = points;

      resize();
      buildParticles(points);
      start = performance.now();
      if (still) draw(start);
      else {
        observer.observe(wrap);
        startLoop();
      }
    };

    if (image.complete) boot();
    else {
      image.onload = boot;
      image.onerror = () => {
        /* form stays absent rather than breaking the hero */
      };
    }

    window.addEventListener("resize", onResize, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      stopLoop();
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div ref={wrapRef} aria-hidden="true" className={className}>
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
