// Server-side Supabase client backed by request/response cookies.
//
// Used by the /auth/callback server route to run the PKCE code exchange and
// write the resulting session into @supabase/ssr cookies. It deliberately does
// NOT touch the service-role client or any AI/backend code paths.
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database } from './types';
import { serverEnv } from '@/lib/env.server';

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith('sb_publishable_') || value.startsWith('sb_secret_');
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (isNewSupabaseApiKey(supabaseKey) && headers.get('Authorization') === `Bearer ${supabaseKey}`) {
      headers.delete('Authorization');
    }
    headers.set('apikey', supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function parseCookieHeader(header: string): { name: string; value: string }[] {
  if (!header) return [];
  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf('=');
      if (index === -1) return { name: part, value: '' };
      return {
        name: part.slice(0, index).trim(),
        value: decodeURIComponent(part.slice(index + 1).trim()),
      };
    });
}

function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  parts.push(`SameSite=${(options.sameSite as string) ?? 'lax'}`);
  if (options.secure) parts.push('Secure');
  if (options.httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}

/**
 * Create a request-scoped Supabase client. `cookiesToSet` collects the
 * Set-Cookie headers that must be attached to the response.
 */
export function createSupabaseServerClient(request: Request) {
  const SUPABASE_URL = serverEnv('SUPABASE_URL');
  const SUPABASE_PUBLISHABLE_KEY = serverEnv('SUPABASE_PUBLISHABLE_KEY');

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ['SUPABASE_URL'] : []),
      ...(!SUPABASE_PUBLISHABLE_KEY ? ['SUPABASE_PUBLISHABLE_KEY'] : []),
    ];
    throw new Error(`Missing Supabase environment variable(s): ${missing.join(', ')}.`);
  }

  const secure = new URL(request.url).protocol === 'https:';
  const setCookieHeaders: string[] = [];

  const client = createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY) },
    cookieOptions: { path: '/', sameSite: 'lax', secure, maxAge: 60 * 60 * 24 * 365 },
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('cookie') ?? '');
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          setCookieHeaders.push(
            serializeCookie(name, value, { path: '/', sameSite: 'lax', secure, ...options }),
          );
        }
      },
    },
  });

  return { client, setCookieHeaders };
}
