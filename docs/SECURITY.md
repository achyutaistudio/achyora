# ACHYORA — Security model

## Trust boundary

The browser is untrusted. Every entitlement decision — credits, guest quota,
subscription tier, file ownership, rate limits — is made on the server and
persisted in Postgres. Client state is display only.

| Client | Auth | RLS | Used for |
| --- | --- | --- | --- |
| `@/integrations/supabase/client` | user session | applies | Components, realtime, direct storage upload to the caller's own path |
| `requireSupabaseAuth` context client | verified bearer | applies as that user | All authenticated server functions |
| `@/integrations/supabase/client.server` (service role) | none | **bypassed** | Verified webhooks, guest quota, credit ledger — loaded inside handlers only |

The service-role key is never imported at module scope in a client-reachable
file, never returned to the browser, and never used to decide whether the
caller is privileged.

## Authentication

- Sessions are Supabase JWTs. Server functions verify the bearer token through
  `requireSupabaseAuth`; the route guard is UX, the middleware is the boundary.
- Server-side identity uses `auth.getUser()` (revalidated), not `getSession()`.
- Protected pages live under the `_authenticated` layout; the RPC endpoints
  behind them are independently protected.
- Redirect URLs are derived from the live request origin, so no environment
  hard-codes a domain. Allowed callback URLs are configured in Supabase.

## Row Level Security

RLS is enabled on every table in `public`. Policies are scoped to
`auth.uid()`. Explicit `GRANT`s accompany every table; `anon` is granted only
where a public read policy exists (`plans`, and public content tables).

Roles are stored in a dedicated `user_roles` table and checked with a
`SECURITY DEFINER` `has_role()` function — never on a profile row, never from
client storage.

## Credits and quotas

- Credit spend is a single atomic RPC that checks and decrements in one
  statement, so concurrent requests cannot overspend.
- Every AI call that fails after a successful spend triggers a refund of the
  exact amount, recorded in the ledger.
- Guest quota (3 messages / 24 h) is keyed on a **salted hash** of IP + user
  agent (`GUEST_HASH_SALT`). Raw IP addresses are never stored. Clearing
  cookies or local storage does not reset it.

## Rate limiting

`public.api_rate_limits` plus the atomic `consume_rate_limit` RPC enforce a
fixed-window limit per subject and bucket. Because the counter is in the
database, it holds across serverless instances and cold starts. Applied to
guest chat, chat, compare, research, image, video, voice, library writes and
checkout. Exceeding a limit returns `RATE_LIMITED` (HTTP 429 with
`Retry-After` on the public endpoint).

## File storage

- The `library` bucket is **private**. There are no public object URLs.
- The server chooses the storage path; it is always
  `<user-id>/<uuid>-<sanitised name>`. Client-supplied paths are rejected, and
  traversal characters are stripped.
- After upload the server re-reads the object's **real** size and MIME type
  from storage and deletes the object if it violates the size ceiling or the
  MIME allow-list. Client-declared metadata is never trusted.
- Downloads use short-lived signed URLs issued only to the owner.
- Deleting a record removes the storage object first, so orphans cannot
  accumulate.

## Payments

- Orders are created server-side; amounts come from the database `plans`
  table, never from the request body.
- A subscription is activated **only** by the Razorpay webhook after
  HMAC-SHA256 signature verification with a timing-safe comparison over the
  raw request body.
- Webhook events are de-duplicated through a unique event id table, so
  retries cannot double-credit an account.
- The browser success callback updates the UI only; it grants nothing.

## Public endpoints

`/api/public/*` bypasses platform auth by design. Each handler is responsible
for its own protection:

| Endpoint | Protection |
| --- | --- |
| `/api/public/chat` | Salted-hash guest quota + rate limit + input validation; no PII returned |
| `/api/public/razorpay-webhook` | HMAC signature verification + replay de-duplication |

## Input handling

All server function inputs are validated with Zod before use: length bounds on
prompts and messages, enum checks on model and plan ids, and format checks on
identifiers. Provider errors are logged server-side and returned to users as
generic, non-leaking messages.

## Secrets hygiene

- No secret is prefixed `VITE_`.
- `process.env` is read inside handlers, not at module scope.
- Errors never echo keys, tokens or raw provider payloads.
- `.env` is git-ignored; `.env.example` contains names only.

## Reporting

Report suspected vulnerabilities privately to the repository owner before
public disclosure.
