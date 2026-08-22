# ACHYORA — Deployment

The repository is the product. A fresh clone plus environment variables plus
one-time provider dashboard settings is everything a deployment needs. **No
source file has to be edited to deploy, change domain, change AI provider, or
change payment configuration.**

No Lovable service is required at runtime.

---

## 0. What the build produces

`npm run build` targets Cloudflare Workers:

| Condition                 | Nitro preset        | Output                              |
| ------------------------- | ------------------- | ----------------------------------- |
| default                   | `cloudflare-module` | `dist/server` (worker) + `dist/client` (assets) |
| `NITRO_PRESET=<preset>`   | that preset         | preset default                      |

The build also writes `dist/server/wrangler.json` (entry `index.mjs`,
`nodejs_compat`, `ASSETS` bound to `../client`), so `wrangler deploy` needs no
hand-written config.

---

## 1. GitHub

```bash
git clone <your-repo> achyora
cd achyora
npm install
cp .env.example .env      # fill in values for local dev
npm run dev
```

Nothing in `.gitignore`d state is required by the application. `.env` is local
only; hosts get the same variable names through their own settings UI.

---

## 2. Deploy to Cloudflare Workers (from GitHub)

Cloudflare dashboard -> **Workers & Pages** -> **Create** -> **Import a
repository**, then:

| Setting                | Value             |
| ---------------------- | ----------------- |
| Build command          | `npm run build`   |
| Deploy command         | `npx wrangler deploy` |
| Root directory         | `/`               |
| Path to wrangler config| `dist/server/wrangler.json` |

Add the variables from section 3 under **Settings -> Variables and Secrets**
(plain variables for `VITE_*`, secrets for everything else) and make sure they
are also present for the **build**, not only at runtime.

Local equivalent:

```bash
npm run build
npx wrangler dev --local      # smoke test on the Workers runtime
npx wrangler deploy -c dist/server/wrangler.json
```

`VITE_*` values are inlined at **build** time, so they must exist in the build
environment, not only at runtime.

---

## 3. Environment variables

Copy the names from [`.env.example`](../.env.example). Minimum viable set:

**Required**

```
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
```

**AI — one of these combinations**

```
AI_PROVIDER=gemini      + GEMINI_API_KEY
AI_PROVIDER=openai      + OPENAI_API_KEY
AI_PROVIDER=anthropic   + ANTHROPIC_API_KEY
AI_PROVIDER=gateway     + AI_GATEWAY_BASE_URL + AI_GATEWAY_API_KEY
```

`AI_PROVIDER` is authoritative. If it names a provider that is not configured,
requests fail with a clear configuration error — they are never rerouted to a
different vendor.

**Payments (optional until you sell)**

```
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
```

**Recommended**

```
GUEST_HASH_SALT   long random string
VITE_SITE_URL     https://your-domain.com   (canonical/og:url only)
```

---

## 4. Supabase configuration (one time, dashboard)

1. **Apply the schema.** Run the SQL in `supabase/migrations/` in order, then
   the files in `db/`, using the Supabase SQL editor or
   `supabase db push`. Every file is idempotent-safe to run once.
2. **Storage.** Create a **private** bucket named `library` (the storage
   policies in `supabase/migrations/*library*` assume it exists).
3. **Auth → URL Configuration**
   - *Site URL*: your production origin, e.g. `https://achyora.com`
   - *Redirect URLs*: add
     `https://achyora.com/auth/callback`,
     `https://achyora.com/auth/reset-password`,
     plus the same two paths for any preview domain and
     `http://localhost:8080/auth/callback` for local dev.

The app itself builds redirect URLs from the live request origin, so changing
domain never requires a code change — only this dashboard list.

---

## 5. Google OAuth (one time, dashboard)

1. Google Cloud Console → Credentials → OAuth 2.0 Client.
2. Authorised redirect URI:
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. Supabase → Authentication → Providers → Google: paste the client id and
   secret, enable.
4. Ensure your production origin is in the Supabase redirect list (section 4).

---

## 6. Razorpay webhook (one time, dashboard)

1. Razorpay Dashboard → Settings → Webhooks → Add.
2. URL: `https://<your-production-domain>/api/public/razorpay-webhook`
3. Secret: the same value as the `RAZORPAY_WEBHOOK_SECRET` environment
   variable.
4. Events: `payment.captured`, `payment.failed`, `order.paid`.

The endpoint verifies the HMAC signature and de-duplicates events through
`public.processed_webhook_events`. Subscriptions are **only** activated by the
verified webhook, never by a browser success callback.

---

## 7. Build and verify

```bash
npm install
npm run typecheck
npm run lint
npm run build
```

Post-deploy checklist:

- [ ] Home page renders and the guest chat answers (3 free messages / 24 h).
- [ ] Fourth guest message is rejected, and stays rejected after a refresh.
- [ ] Sign up, sign in, sign out, hard refresh keeps the session.
- [ ] Google sign-in returns to `/auth/callback` and lands in the workspace.
- [ ] `/workspace/chat` sends a message, credits decrement, history persists.
- [ ] `/workspace/library` uploads, lists, opens and deletes a file.
- [ ] `/workspace/image` generates; a provider failure refunds credits.
- [ ] `/workspace/video` starts a job, polls, and stops within
      `VIDEO_MAX_POLL_SECONDS`.
- [ ] `/pricing` shows the canonical prices for INR and USD.
- [ ] A Razorpay test payment activates Pro through the webhook only.

---

## 8. Changing things later — without touching source

| Change                     | Where                                            |
| -------------------------- | ------------------------------------------------ |
| Domain                     | Host domain settings + Supabase redirect URLs     |
| AI provider or model       | `AI_PROVIDER`, `AI_*_MODEL` env vars              |
| OpenAI-compatible gateway  | `AI_GATEWAY_BASE_URL` + `AI_GATEWAY_API_KEY`      |
| Rate limits                | `RATE_LIMIT_*` env vars                           |
| Library size / MIME policy | `LIBRARY_MAX_UPLOAD_BYTES`, `LIBRARY_EXTRA_MIME_TYPES` |
| Video polling ceiling      | `VIDEO_MAX_POLL_SECONDS`                          |
| Razorpay keys / webhook    | Env vars + Razorpay dashboard                     |
| Host (Cloudflare → other)  | Nothing, or `NITRO_PRESET` for a third host       |
