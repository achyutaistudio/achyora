/**
 * Durable, deployment-wide rate limiting.
 *
 * Backed by Postgres (public.consume_rate_limit), never by process memory, so
 * the limit holds across Cloudflare Workers isolates and Vercel lambdas.
 *
 * This is separate from the guest message quota: the quota is a product
 * entitlement (10 messages / 24h), this is abuse protection.
 *
 * Server-only by filename.
 */
import { createHash } from "node:crypto";
import { serverEnv } from "@/lib/env.server";

export type RateLimitBucket =
  | "guest_chat"
  | "chat"
  | "compare"
  | "research"
  | "image"
  | "video"
  | "voice"
  | "checkout"
  | "library_write";

type Limit = { limit: number; windowSeconds: number };

/**
 * Default production limits. Every one of them can be overridden per
 * deployment with `RATE_LIMIT_<BUCKET>=<limit>/<seconds>` (e.g.
 * `RATE_LIMIT_IMAGE=20/3600`), so tuning never requires a source edit.
 */
const DEFAULTS: Record<RateLimitBucket, Limit> = {
  guest_chat: { limit: 10, windowSeconds: 3600 },
  chat: { limit: 60, windowSeconds: 3600 },
  compare: { limit: 20, windowSeconds: 3600 },
  research: { limit: 30, windowSeconds: 3600 },
  image: { limit: 30, windowSeconds: 3600 },
  video: { limit: 10, windowSeconds: 3600 },
  voice: { limit: 40, windowSeconds: 3600 },
  checkout: { limit: 10, windowSeconds: 3600 },
  library_write: { limit: 60, windowSeconds: 3600 },
};

function configuredLimit(bucket: RateLimitBucket): Limit {
  const fallback = DEFAULTS[bucket];
  const raw = serverEnv(`RATE_LIMIT_${bucket.toUpperCase()}`);
  if (!raw) return fallback;
  const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(raw);
  if (!match) return fallback;
  return { limit: Number(match[1]), windowSeconds: Number(match[2]) };
}

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfter: number };

/**
 * Consumes one unit from `bucket` for `subject`.
 *
 * Fails OPEN when the database is unreachable: rate limiting must never be the
 * reason a paying user cannot use the product, and every protected path still
 * has credits / quota as the hard control.
 */
export async function consumeRateLimit(
  bucket: RateLimitBucket,
  subject: string,
): Promise<RateLimitResult> {
  const { limit, windowSeconds } = configuredLimit(bucket);
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const client = supabaseAdmin as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{
        data: unknown;
        error: { message: string } | null;
      }>;
    };
    const { data, error } = await client.rpc("consume_rate_limit", {
      _bucket: bucket,
      _subject: subject,
      _limit: limit,
      _window_seconds: windowSeconds,
    });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as
      { allowed?: boolean; remaining?: number; retry_after?: number } | null | undefined;
    return {
      allowed: row?.allowed !== false,
      remaining: Number(row?.remaining ?? 0),
      retryAfter: Number(row?.retry_after ?? windowSeconds),
    };
  } catch (err) {
    console.error("rate limit check failed", err instanceof Error ? err.message : err);
    return { allowed: true, remaining: 0, retryAfter: 0 };
  }
}

/** Non-reversible subject key for anonymous callers (never stores raw IPs). */
export function anonymousSubject(request: Request): string {
  const headers = request.headers;
  const ip =
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    (headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ??
    "unknown";
  const salt = serverEnv("GUEST_HASH_SALT") ?? "achyora-guest-window";
  return createHash("sha256").update(`${salt}|rl|${ip}`).digest("hex");
}
