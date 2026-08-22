// Browser Supabase client.
//
// Uses @supabase/ssr's createBrowserClient so the auth session lives in
// COOKIES instead of localStorage. That is what makes the server-side PKCE
// code exchange in /auth/callback possible: the PKCE code verifier written
// here is readable by the server, and the session written by the server is
// readable here.
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';

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

    // New Supabase API keys are opaque strings, not bearer JWTs.
    if (isNewSupabaseApiKey(supabaseKey) && headers.get('Authorization') === `Bearer ${supabaseKey}`) {
      headers.delete('Authorization');
    }

    headers.set('apikey', supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

// SSR fallback. `process` does not exist in the browser or in a bare
// Cloudflare Worker, so it is read defensively instead of assumed.
function ssrEnv(name: string): string | undefined {
  const g = globalThis as unknown as {
    __env__?: Record<string, string | undefined>;
    process?: { env?: Record<string, string | undefined> };
  };
  return g.__env__?.[name] ?? g.process?.env?.[name];
}

export function supabaseBrowserConfig(): { url: string; key: string } {
  // Unchanged environment variable names.
  const SUPABASE_URL = import.meta.env['VITE_SUPABASE_URL'] || ssrEnv('SUPABASE_URL');
  const SUPABASE_PUBLISHABLE_KEY =
    import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'] || ssrEnv('SUPABASE_PUBLISHABLE_KEY');

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ['SUPABASE_URL'] : []),
      ...(!SUPABASE_PUBLISHABLE_KEY ? ['SUPABASE_PUBLISHABLE_KEY'] : []),
    ];
    const message = `Missing Supabase environment variable(s): ${missing.join(', ')}. Connect Supabase in Lovable Cloud.`;
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  return { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY };
}

function createSupabaseClient() {
  const { url, key } = supabaseBrowserConfig();

  return createBrowserClient<Database>(url, key, {
    global: {
      fetch: createSupabaseFetch(key),
    },
    // Cookie chunking/serialisation is handled by @supabase/ssr. Cookies must
    // be readable by the server callback, so they are not http-only and are
    // scoped to the whole site.
    cookieOptions: {
      path: '/',
      sameSite: 'lax',
      secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
      maxAge: 60 * 60 * 24 * 365,
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // PKCE + server-side exchange. The callback is a server route, so
      // detectSessionInUrl must stay OFF: the browser must never try a second
      // exchange of a code the server already consumed.
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";
export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
