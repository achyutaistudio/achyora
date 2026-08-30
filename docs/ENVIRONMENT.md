# ACHYORA — Environment reference

Every runtime decision is made from these variables. Application source never
needs editing to change provider, keys, domain, limits or host.

Two namespaces:

- **`VITE_*`** — read with `import.meta.env`, **inlined into the browser
  bundle at build time**. Public by definition; never put a secret here.
- **everything else** — read with `process.env` **inside server handlers
  only**, never at module scope (serverless env is injected per request).

---

## Client (public, build-time)

| Name | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | Supabase project URL for the browser client. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | Publishable/anon key. Safe to expose; RLS is the boundary. |
| `VITE_SUPABASE_PROJECT_ID` | no | Reference only; not read by code. |
| `VITE_SITE_URL` | no | Canonical origin for `<link rel=canonical>` and `og:url`. Auth never depends on it. |
| `VITE_POSTHOG_KEY` | no | Enables product analytics. Analytics is a no-op when unset. |
| `VITE_POSTHOG_HOST` | no | Defaults to `https://us.i.posthog.com`. |

## Supabase (server)

| Name | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Server-side project URL. |
| `SUPABASE_PUBLISHABLE_KEY` | yes | Used by `requireSupabaseAuth` to act as the signed-in user, with RLS applied. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Bypasses RLS. Used only for verified webhooks, guest quota bookkeeping, and credit ledger writes. Never sent to the browser. |
| `SUPABASE_PROJECT_ID` | no | Reference only. |

## AI selection

| Name | Required | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | no | `gemini` \| `openai` \| `anthropic` \| `gateway`. **Authoritative when set**: a missing key for the named provider is a configuration error, not a reason to fall back. Unset = first configured provider wins. |
| `AI_CHAT_MODEL` | no | Overrides the chat model id for the active provider. |
| `AI_IMAGE_MODEL` | no | Overrides the image model id. |
| `AI_VIDEO_MODEL` | no | Overrides the video model id. |
| `AI_TRANSCRIBE_MODEL` | no | Overrides the speech-to-text model id. |

## AI vendor keys

| Name | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | for `gemini` | Google AI Studio key. Also required for video generation. |
| `OPENAI_API_KEY` | for `openai` | OpenAI key. |
| `OPENAI_BASE_URL` | no | Point the OpenAI client at a compatible proxy. |
| `ANTHROPIC_API_KEY` | for `anthropic` | Anthropic key (chat only). |

## AI gateway (any OpenAI-compatible host)

| Name | Required | Purpose |
| --- | --- | --- |
| `AI_GATEWAY_BASE_URL` | for `gateway` | Full base URL, e.g. `https://openrouter.ai/api/v1`. **No default host exists.** |
| `AI_GATEWAY_API_KEY` | for `gateway` | Bearer token for that host. |
| `AI_GATEWAY_CHAT_MODEL` | no | Defaults to `gpt-4o-mini`. |
| `AI_GATEWAY_IMAGE_MODEL` | no | Image model id for the gateway. |

If `AI_PROVIDER=gateway` and either of the two required values is missing, all
AI requests return `AI gateway is not configured…` with an explicit
`AI_NOT_CONFIGURED` code. There is no hidden fallback endpoint or vendor.

## Payments (Razorpay)

| Name | Required | Purpose |
| --- | --- | --- |
| `RAZORPAY_KEY_ID` | to sell | Order creation and browser checkout handle. |
| `RAZORPAY_KEY_SECRET` | to sell | Server-side order creation. Never exposed. |
| `RAZORPAY_WEBHOOK_SECRET` | to sell | HMAC verification for `/api/public/razorpay-webhook`. Subscriptions activate only through this verified path. |

Payments are optional: with these unset, the pricing page still renders and
checkout returns a clean "payments are not configured" error.

## Limits and safety

| Name | Default | Purpose |
| --- | --- | --- |
| `GUEST_HASH_SALT` | dev-only fallback | Salt for hashing visitor IP/UA. Raw IPs are never stored. **Set a long random value in production.** |
| `LIBRARY_MAX_UPLOAD_BYTES` | `20971520` (20 MB) | Server-enforced upload ceiling, re-checked against real object metadata after upload. |
| `LIBRARY_EXTRA_MIME_TYPES` | — | Comma-separated additions to the MIME allow-list. |
| `VIDEO_MAX_POLL_SECONDS` | `600` | Wall-clock cap on a video job. On timeout the job is failed and credits are refunded. |

## Rate limits

Format `<requests>/<seconds>`. These are abuse protection, independent of
credits and guest quota. Counters live in Postgres, so they hold across
serverless instances.

| Name | Default | Scope |
| --- | --- | --- |
| `RATE_LIMIT_GUEST_CHAT` | `10/3600` | Hashed visitor |
| `RATE_LIMIT_CHAT` | `60/3600` | User |
| `RATE_LIMIT_COMPARE` | `20/3600` | User |
| `RATE_LIMIT_RESEARCH` | `30/3600` | User |
| `RATE_LIMIT_IMAGE` | `30/3600` | User |
| `RATE_LIMIT_VIDEO` | `10/3600` | User |
| `RATE_LIMIT_VOICE` | `40/3600` | User |
| `RATE_LIMIT_CHECKOUT` | `10/3600` | User |
| `RATE_LIMIT_LIBRARY_WRITE` | `60/3600` | User |

## Deployment

| Name | Default | Purpose |
| --- | --- | --- |
| `NITRO_PRESET` | `cloudflare-module` | Server build target. Set explicitly only for another host. |

---

## Rules enforced in code

- Secrets are read inside handlers, never at module scope.
- No `VITE_`-prefixed secret exists anywhere in the repository.
- No production URL, project ref, vendor host or key is hard-coded.
- A missing optional variable degrades a feature with a clear message; a
  missing required variable fails loudly at first use rather than silently.
