-- ACHYORA production hardening.
-- Atomic credit refunds, video failure handling, payment order tracking and
-- atomic Razorpay webhook entitlement processing.

CREATE TABLE IF NOT EXISTS public.payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'razorpay',
  provider_order_id text NOT NULL UNIQUE,
  plan_id text NOT NULL CHECK (plan_id IN ('pro-weekly','pro-monthly','pro-yearly')),
  currency text NOT NULL CHECK (currency IN ('INR','USD')),
  amount integer NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','failed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS payment_orders_user_idx ON public.payment_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_orders_status_idx ON public.payment_orders(status, created_at DESC);
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_orders_own_select" ON public.payment_orders;
CREATE POLICY "payment_orders_own_select" ON public.payment_orders
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.payment_orders TO authenticated;
GRANT ALL ON public.payment_orders TO service_role;

-- Private library bucket: the migration chain must provision the bucket too.
INSERT INTO storage.buckets (id, name, public)
VALUES ('library', 'library', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Make refund itself safe for missing bootstrap rows and serialise the balance update.
CREATE OR REPLACE FUNCTION public.refund_credits(_user_id uuid, _amount integer, _reason text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b integer;
BEGIN
  IF _amount <= 0 THEN RAISE EXCEPTION 'invalid refund amount'; END IF;
  INSERT INTO public.user_credits (user_id)
  VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.user_credits AS uc
  SET balance = LEAST(uc.balance + _amount, uc.daily_allowance), updated_at = now()
  WHERE uc.user_id = _user_id
  RETURNING uc.balance INTO b;

  IF b IS NULL THEN RAISE EXCEPTION 'credit account not found'; END IF;

  INSERT INTO public.credit_transactions (user_id, delta, reason)
  VALUES (_user_id, _amount, _reason);
  RETURN b;
END; $$;
REVOKE ALL ON FUNCTION public.refund_credits(uuid,integer,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credits(uuid,integer,text) TO service_role;

-- Atomically transition a video from processing -> failed and refund exactly once.
CREATE OR REPLACE FUNCTION public.fail_video_and_refund(
  _media_id uuid,
  _user_id uuid,
  _amount integer,
  _reason text
)
RETURNS TABLE (handled boolean, balance integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b integer;
BEGIN
  UPDATE public.generated_media
  SET status = 'failed'
  WHERE id = _media_id
    AND user_id = _user_id
    AND media_type = 'video'
    AND status = 'processing';

  IF NOT FOUND THEN
    SELECT uc.balance INTO b FROM public.user_credits AS uc WHERE uc.user_id = _user_id;
    RETURN QUERY SELECT false, COALESCE(b, 0);
    RETURN;
  END IF;

  INSERT INTO public.user_credits (user_id)
  VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.user_credits AS uc
  SET balance = LEAST(uc.balance + _amount, uc.daily_allowance), updated_at = now()
  WHERE uc.user_id = _user_id
  RETURNING uc.balance INTO b;

  IF b IS NULL THEN RAISE EXCEPTION 'credit account not found'; END IF;

  INSERT INTO public.credit_transactions (user_id, delta, reason)
  VALUES (_user_id, _amount, _reason);

  RETURN QUERY SELECT true, b;
END; $$;
REVOKE ALL ON FUNCTION public.fail_video_and_refund(uuid,uuid,integer,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_video_and_refund(uuid,uuid,integer,text) TO service_role;

-- A single transaction owns the webhook claim and subscription mutation.
-- If entitlement/audit insertion fails, the unique claim rolls back and
-- Razorpay can retry instead of receiving a false 200 acknowledgement.
CREATE OR REPLACE FUNCTION public.process_razorpay_webhook(
  _event_id text,
  _event text,
  _user_id uuid,
  _plan_id text,
  _currency text,
  _provider_order_id text,
  _period_days integer,
  _is_success boolean
)
RETURNS TABLE (status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inserted_count integer;
  expected_amount integer;
  actual_order public.payment_orders%ROWTYPE;
  period_end timestamptz;
BEGIN
  IF _event_id IS NULL OR length(trim(_event_id)) = 0 THEN RAISE EXCEPTION 'missing event id'; END IF;
  IF _user_id IS NULL THEN RAISE EXCEPTION 'missing user id'; END IF;
  IF _provider_order_id IS NULL OR length(trim(_provider_order_id)) = 0 THEN RAISE EXCEPTION 'missing order id'; END IF;

  INSERT INTO public.processed_webhook_events(id, provider, event, user_id)
  VALUES (_event_id, 'razorpay', _event, _user_id)
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count = 0 THEN
    RETURN QUERY SELECT 'duplicate'::text;
    RETURN;
  END IF;

  SELECT * INTO actual_order
  FROM public.payment_orders
  WHERE provider_order_id = _provider_order_id
    AND provider = 'razorpay'
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'unknown Razorpay order'; END IF;
  IF actual_order.user_id <> _user_id THEN RAISE EXCEPTION 'order user mismatch'; END IF;
  IF actual_order.plan_id <> _plan_id THEN RAISE EXCEPTION 'order plan mismatch'; END IF;
  IF actual_order.currency <> _currency THEN RAISE EXCEPTION 'order currency mismatch'; END IF;

  IF _is_success THEN
    IF _period_days <= 0 THEN RAISE EXCEPTION 'invalid subscription period'; END IF;
    period_end := now() + make_interval(days => _period_days);
    UPDATE public.payment_orders
    SET status = 'paid', paid_at = now()
    WHERE id = actual_order.id;

    INSERT INTO public.subscriptions (
      user_id, plan, status, currency, provider, provider_subscription_id,
      current_period_end, updated_at
    ) VALUES (
      _user_id, _plan_id, 'active', _currency, 'razorpay', _provider_order_id,
      period_end, now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      plan = EXCLUDED.plan,
      status = EXCLUDED.status,
      currency = EXCLUDED.currency,
      provider = EXCLUDED.provider,
      provider_subscription_id = EXCLUDED.provider_subscription_id,
      current_period_end = EXCLUDED.current_period_end,
      updated_at = now();

    INSERT INTO public.audit_logs(user_id, event, details)
    VALUES (_user_id, 'subscription_activated', jsonb_build_object(
      'plan', _plan_id, 'event', _event, 'order_id', _provider_order_id
    ));
  ELSE
    UPDATE public.payment_orders SET status = 'failed' WHERE id = actual_order.id;
    UPDATE public.subscriptions
    SET status = CASE WHEN _event = 'payment.failed' THEN 'past_due' ELSE 'cancelled' END,
        updated_at = now()
    WHERE user_id = _user_id;

    INSERT INTO public.audit_logs(user_id, event, details)
    VALUES (_user_id, 'subscription_state_changed', jsonb_build_object(
      'event', _event, 'order_id', _provider_order_id
    ));
  END IF;

  RETURN QUERY SELECT 'processed'::text;
END; $$;
REVOKE ALL ON FUNCTION public.process_razorpay_webhook(text,text,uuid,text,text,text,integer,boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_razorpay_webhook(text,text,uuid,text,text,text,integer,boolean) TO service_role;

-- Stronger relational ownership for client inserts.
DROP POLICY IF EXISTS "msg_own_insert" ON public.messages;
CREATE POLICY "msg_own_insert" ON public.messages
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id AND c.user_id = auth.uid()
  )
);


-- Atomically return one guest attempt.
CREATE OR REPLACE FUNCTION public.release_guest_message(_hash text)
RETURNS TABLE (used integer, remaining integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE row public.guest_usage%ROWTYPE;
BEGIN
  SELECT * INTO row FROM public.guest_usage WHERE visitor_hash = _hash FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 0, 3; RETURN; END IF;
  UPDATE public.guest_usage
  SET message_count = GREATEST(message_count - 1, 0), updated_at = now()
  WHERE visitor_hash = _hash
  RETURNING * INTO row;
  RETURN QUERY SELECT row.message_count, GREATEST(3 - row.message_count, 0);
END; $$;
REVOKE ALL ON FUNCTION public.release_guest_message(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_guest_message(text) TO service_role;
