
CREATE TABLE IF NOT EXISTS public.processed_webhook_events (
  id text PRIMARY KEY,
  provider text NOT NULL DEFAULT 'razorpay',
  event text NOT NULL DEFAULT '',
  user_id uuid,
  processed_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.processed_webhook_events TO service_role;

ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;
