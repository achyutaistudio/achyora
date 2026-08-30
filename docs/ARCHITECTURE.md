# ACHYORA — Architecture

## Stack

- **TanStack Start v1** (React 19, Vite 7) — file-based routing, SSR, typed
  server functions.
- **Supabase** — Postgres, Auth, private Storage. Reached through the standard
  client libraries; no builder-specific runtime.
- **Nitro** — builds the Cloudflare Worker bundle (`cloudflare-module` preset).
- **Tailwind v4** — design tokens in `src/styles.css`, no ad-hoc colours in
  components.

Nothing at runtime depends on the tool the project was authored in.

## Layout

```
src/
  routes/                 file-based routes; each page owns its head()
    index.tsx             public landing + guest chat
    auth*.tsx             sign in / callback / reset
    pricing.tsx
    _authenticated/       route guard for the workspace subtree
    workspace/            chat, research, sanatan, image, video, voice,
                          library, settings
    api/public/           unauthenticated HTTP: guest chat, Razorpay webhook
  lib/
    *.functions.ts        createServerFn RPC — the only entry points the UI calls
    *.server.ts           server-only logic; never imported by components
    ai/provider.server.ts provider abstraction (gemini/openai/anthropic/gateway)
    credits.server.ts     atomic spend + refund
    ratelimit.server.ts   database-backed fixed-window limiter
    library.server.ts     path, size and MIME policy
    errors.ts             shared error codes and user-facing messages
  components/             presentational UI, shared states, chrome
  integrations/supabase/  generated clients, auth middleware, types
supabase/migrations/      schema, RLS, grants, storage policies, seed data
db/                       later additive migrations
docs/                     this documentation set
```

## Request flow

```
component
   -> useServerFn(fn)                     typed RPC, bearer attached automatically
      -> requireSupabaseAuth              verifies JWT, injects user-scoped client
         -> consumeRateLimit              atomic Postgres fixed window
            -> spend(credits)             atomic check-and-decrement
               -> provider.server.ts      vendor call chosen from AI_PROVIDER
                  -> refund on failure    exact amount, ledger recorded
```

Guest traffic skips the middleware and enters through
`/api/public/chat`, which applies the salted-hash quota and its own rate limit
before calling the same provider layer.

## The AI provider abstraction

`src/lib/ai/provider.server.ts` is the single vendor boundary. It exposes
`chat`, `generateImage`, `startVideoJob`, `getVideoJob` and `transcribe`, and
resolves the concrete vendor at call time:

1. If `AI_PROVIDER` is set, that provider is used. If it is not configured,
   the call fails with `AI_NOT_CONFIGURED` — it is never rerouted to another
   vendor, and there is no built-in gateway host.
2. If unset, the first provider with a usable key is chosen.

Adding a vendor means adding one adapter in this file. No route, component or
other library module names a vendor.

## Data model

| Table | Purpose |
| --- | --- |
| `profiles` | One row per auth user, created by trigger on sign-up. |
| `user_roles` | Roles, separate from profiles, read via `has_role()`. |
| `credits` / `credit_ledger` | Balance plus an append-only audit of spends and refunds. |
| `plans` | Canonical INR/USD pricing and credit grants. Public read. |
| `subscriptions` | Active tier, written only by the verified webhook. |
| `conversations` / `messages` | Chat history, owner-scoped. |
| `generated_media` | Image and video jobs with status. |
| `library_items` | File metadata; the object itself lives in private storage. |
| `guest_usage` | Salted-hash keyed guest quota. |
| `api_rate_limits` | Fixed-window abuse counters. |
| `processed_webhook_events` | Webhook replay protection. |

Every table has RLS enabled, explicit grants, and `auth.uid()`-scoped
policies.

## Rendering and SEO

Public pages (landing, pricing, legal) are server-rendered with their own
`head()` — unique title, description, OG and Twitter tags. Workspace pages are
`noindex`. Canonical and `og:url` come from optional `VITE_SITE_URL`, so the
domain is configuration rather than code.

## Error handling

`src/lib/errors.ts` defines a closed set of codes (`AI_NOT_CONFIGURED`,
`INSUFFICIENT_CREDITS`, `RATE_LIMITED`, `GUEST_LIMIT_REACHED`,
`AI_SERVICE_ERROR`, `NOT_FOUND`, …) and their user-facing text. Server
functions return `{ ok: false, code, message }` rather than throwing across
the RPC boundary; the UI renders the message directly. Provider details stay
in server logs.

## Build targets

`npm run build` emits a Cloudflare module worker in `dist/` (worker in
`dist/server`, static assets in `dist/client`). `NITRO_PRESET` overrides the
preset for another host; the application code is unchanged either way.
