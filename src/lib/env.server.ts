/**
 * Single server-side environment accessor.
 *
 * Runtime environment variables only.
 *
 * Supported targets:
 *   - Cloudflare Workers (bindings are supplied by src/server.ts)
 *   - Node/Vercel
 *   - local development
 *   - local production Worker
 *
 * IMPORTANT:
 * No VITE_* variables are used here.
 *
 * Supabase:
 *   SUPABASE_URL
 *   SUPABASE_PUBLISHABLE_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Server-only secrets are read only from the runtime environment.
 */

type EnvBag = Record<string, string | undefined>;

function bags(): EnvBag[] {
  const g = globalThis as unknown as {
    __env__?: EnvBag;
    process?: {
      env?: EnvBag;
    };
  };

  return [
    // Cloudflare Worker bindings/secrets are copied into globalThis by the
    // worker entry immediately before dispatching each request. This avoids a
    // static `cloudflare:workers` import, which Vite/Rolldown cannot resolve
    // during the generic TanStack Start SSR build.
    g.__env__ ?? {},

    typeof process !== "undefined" && process.env
      ? (process.env as EnvBag)
      : {},

    g.process?.env ?? {},
  ];
}

function clean(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/**
 * Read runtime environment variables only.
 *
 * There is intentionally NO import.meta.env fallback.
 */
function lookup(name: string): string | undefined {
  for (const bag of bags()) {
    const value = clean(bag[name]);

    if (value) {
      return value;
    }
  }

  return undefined;
}

/**
 * Optional ACHYORA_* namespace support.
 *
 * Example:
 *   ACHYORA_SUPABASE_URL
 *   ACHYORA_SUPABASE_SERVICE_ROLE_KEY
 */
const NAMESPACE_PREFIXES = ["ACHYORA_"];

/**
 * Remove trailing slashes from URL variables.
 */
function normalize(name: string, value: string): string {
  return name.endsWith("_URL") ? value.replace(/\/+$/, "") : value;
}

/**
 * Resolve a server-side environment variable.
 *
 * Canonical runtime name is always checked first.
 * ACHYORA_* is an optional fallback.
 */
export function serverEnv(name: string): string | undefined {
  const resolved = resolve(name);

  return resolved === undefined ? undefined : normalize(name, resolved);
}

function resolve(name: string): string | undefined {
  // First: exact canonical name.
  const direct = lookup(name);

  if (direct) {
    return direct;
  }

  // Second: optional ACHYORA_* name.
  for (const prefix of NAMESPACE_PREFIXES) {
    if (name.startsWith(prefix)) {
      continue;
    }

    const namespaced = lookup(`${prefix}${name}`);

    if (namespaced) {
      return namespaced;
    }
  }

  return undefined;
}

export function requireServerEnv(name: string): string {
  const value = serverEnv(name);

  if (!value) {
    throw new Error(`Missing required server environment variable: ${name}`);
  }

  return value;
}
