/**
 * Bearer-token authentication for raw server routes.
 *
 * `requireSupabaseAuth` only covers server functions; the streaming chat route
 * needs the same guarantees (validated token, RLS-scoped client) from a plain
 * HTTP handler. Environment values go through `serverEnv` so the route works on
 * Cloudflare Workers, where `process.env` is not always populated.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { serverEnv } from "@/lib/env.server";

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function supabaseFetch(apiKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    if (isNewSupabaseApiKey(apiKey) && headers.get("Authorization") === `Bearer ${apiKey}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", apiKey);
    return fetch(input, { ...init, headers });
  };
}

export type AuthedRequest = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

export class AuthConfigurationError extends Error {}

/** Returns the caller's RLS-scoped client, or null when the token is absent/invalid. */
export async function authenticateRequest(request: Request): Promise<AuthedRequest | null> {
  const url = serverEnv("SUPABASE_URL");
  const key = serverEnv("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) {
    throw new AuthConfigurationError(
      "Supabase is not configured on this deployment (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY).",
    );
  }

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token || token.split(".").length !== 3) return null;

  const supabase = createClient<Database>(url, key, {
    global: { fetch: supabaseFetch(key), headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || !userId) return null;
  return { supabase, userId };
}
