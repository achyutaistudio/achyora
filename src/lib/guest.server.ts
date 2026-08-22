import { createHash } from "node:crypto";
import { serverEnv } from "@/lib/env.server";

/**
 * Derives a stable, non-reversible visitor key for server-side guest limits.
 * We never store raw IP addresses.
 */
export function visitorHash(request: Request): string {
  const headers = request.headers;
  const ip =
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    (headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ??
    "unknown";
  const ua = headers.get("user-agent") ?? "unknown";
  const salt = serverEnv("GUEST_HASH_SALT") ?? "achyora-guest-window";
  return createHash("sha256").update(`${salt}|${ip}|${ua}`).digest("hex");
}
