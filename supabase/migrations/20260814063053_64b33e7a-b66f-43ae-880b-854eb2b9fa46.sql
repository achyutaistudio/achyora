-- Hardened delta migration. The core schema is created by 20260812092416.
-- This migration only adds webhook idempotency/restricted grants and is safe on a fresh DB.

REVOKE ALL ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM public, anon, authenticated;

DROP POLICY IF EXISTS "guest_usage_no_client_access" ON public.guest_usage;
CREATE POLICY "guest_usage_no_client_access" ON public.guest_usage
  FOR SELECT TO authenticated USING (false);

CREATE TABLE IF NOT EXISTS public.processed_webhook_events (
  id text PRIMARY KEY,
  provider text NOT NULL DEFAULT 'razorpay',
  event text NOT NULL DEFAULT '',
  user_id uuid,
  processed_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.processed_webhook_events TO service_role;
ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "webhook_events_no_client_access" ON public.processed_webhook_events;
CREATE POLICY "webhook_events_no_client_access" ON public.processed_webhook_events
  FOR SELECT TO authenticated USING (false);
