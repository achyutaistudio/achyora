# ACHYORA Production Repair Audit

This archive contains the production-hardening pass requested on 2026-08-21.

## P0 repairs completed

1. **Fresh Supabase migration chain**
   - Converted the duplicate `20260814063053` full-schema migration into a delta migration.
   - Converted the duplicate `20260814063127` storage-policy migration into a no-op compatibility migration.
   - Fresh database provisioning no longer attempts to recreate the original tables/policies.

2. **Razorpay webhook atomicity**
   - Added `process_razorpay_webhook()` as a transactional database RPC.
   - Webhook event claiming, payment-order validation, subscription activation/failure state, and audit logging now commit or roll back together.
   - A failed transaction returns HTTP 500 so Razorpay can retry instead of receiving a false 200.
   - Added `payment_orders` to bind provider order IDs to user/plan/currency/amount.

3. **Video double-refund race**
   - Added `fail_video_and_refund()`.
   - Only the request that atomically changes a video from `processing` to `failed` can issue the refund.
   - Concurrent polling cannot refund the same job twice.

4. **Reliable credit refunds**
   - `refund()` now checks the RPC result and retries up to three times.
   - `refund_credits()` creates a missing credit row safely and serialises the balance update.
   - AI persistence failures now trigger a refund instead of silently charging the user.

5. **Streaming chat persistence**
   - Message/title/update write errors are detected.
   - If the streamed answer was delivered but durable history persistence fails, the chat credit is refunded.

## Additional hardening

- Added `src/lib/credits.ts` as the single source of truth for AI credit costs.
- Unified guest entitlement to **3 messages / 24h**, matching the database, pricing and testing documentation.
- Added atomic `release_guest_message()` for failed guest requests.
- Added private `library` storage bucket provisioning to the canonical migration and provision script.
- Added conversation ownership validation to message INSERT RLS.
- Razorpay checkout now persists an order before returning it to the browser.
- Razorpay checkout UI now actually opens the Razorpay payment window.
- Payment configuration requires the webhook secret too, preventing checkout from appearing available when activation cannot be verified.
- Updated `PROVISION.sql` with the corrected `spend_credits()` implementation and hardening functions.

## Verification performed

- All 135 TypeScript/TSX source files transpile successfully with the installed global TypeScript compiler.
- Modified TS/TSX files were individually transpiled with zero syntax diagnostics.
- Relative/alias import scan found no missing source import; the only non-file import is the intentional Vite `../styles.css?url` import.

## Verification limitation

A full `npm ci`, `typecheck`, `lint`, and production build could not be executed in this environment because the required npm packages are not present in the local cache and registry access timed out. Run those commands in the project environment before deployment.

## Required external configuration

The archive intentionally contains no production secrets. For a live deployment, configure:

- Supabase URL and publishable/service-role keys
- Supabase Auth redirect/site URLs and OAuth providers as desired
- At least one AI provider key/model configuration
- `GUEST_HASH_SALT`
- Razorpay key ID, key secret and webhook secret if payments are enabled
- Cloudflare Worker variables/secrets
- Supabase `library` storage bucket (the migration now provisions it automatically)

## Recommended final verification

```bash
npm ci
npm run typecheck
npm run lint
npm run build
```

Then apply the migrations to a fresh Supabase project and smoke-test signup, login/OAuth, workspace bootstrap, chat, streaming chat, research, image, video, voice and (if enabled) Razorpay sandbox payment/webhook activation.
