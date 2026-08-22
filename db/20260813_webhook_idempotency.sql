-- ACHYORA production hardening: payment webhook idempotency ledger.
--
-- Apply once against the ACHYORA Supabase project (SQL editor, or
-- `supabase db execute -f db/20260813_webhook_idempotency.sql`).
--
-- The Razorpay webhook is the only path that activates a paid plan, and
-- Razorpay retries deliveries. Claiming the provider event id here makes
-- repeat deliveries no-ops: subscription state, entitlements and audit rows
-- are never granted twice.
--
-- Until this table exists the webhook falls back to an audit_logs lookup
-- guard, so payments keep working — but the ledger below is the strong,
-- race-free guarantee. Apply it.

CREATE TABLE IF NOT EXISTS public.processed_webhook_events (
  id text PRIMARY KEY,
  provider text NOT NULL DEFAULT 'razorpay',
  event text NOT NULL DEFAULT '',
  user_id uuid,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- Written only by the webhook handler with the service role.
-- No anon/authenticated grants: the browser must never read or write this.
GRANT ALL ON public.processed_webhook_events TO service_role;

ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;

-- Deliberately no policies: RLS then denies every non-service-role request.
