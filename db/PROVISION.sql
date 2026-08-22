-- ACHYORA — full, idempotent database provisioning.
--
-- WHY THIS FILE EXISTS
-- The connected Supabase project only had a partial, mismatched schema:
-- `profiles`, `conversations` and `messages` existed with columns from an
-- older shape, every GRANT was missing (so even `service_role` got
-- "permission denied"), and none of the functions the app calls
-- (`consume_guest_message`, `consume_rate_limit`, `spend_credits`, ...) or the
-- supporting tables (`user_credits`, `guest_usage`, `api_rate_limits`, ...)
-- existed. That is exactly what produced the runtime errors:
--   "Could not verify your free message allowance."   (missing consume_guest_message)
--   "rate limit check failed ... consume_rate_limit"  (missing consume_rate_limit)
--
-- HOW TO APPLY
-- Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
-- Safe to run repeatedly: every statement is create-if-missing / replace.
-- It never drops a table and never deletes data.

-- ============ helpers ============
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============ profiles ============
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  region text NOT NULL DEFAULT 'IN',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Reconcile a pre-existing table that was created with a different shape.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS region text NOT NULL DEFAULT 'IN';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_own_select" ON public.profiles;
CREATE POLICY "profiles_own_select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_own_insert" ON public.profiles;
CREATE POLICY "profiles_own_insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_own_update" ON public.profiles;
CREATE POLICY "profiles_own_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ credits ============
CREATE TABLE IF NOT EXISTS public.user_credits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 10,
  daily_allowance integer NOT NULL DEFAULT 10,
  resets_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_credits TO authenticated;
GRANT ALL ON public.user_credits TO service_role;
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "credits_own_select" ON public.user_credits;
CREATE POLICY "credits_own_select" ON public.user_credits FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta integer NOT NULL,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_tx_user_idx ON public.credit_transactions(user_id, created_at DESC);
GRANT SELECT ON public.credit_transactions TO authenticated;
GRANT ALL ON public.credit_transactions TO service_role;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "credit_tx_own_select" ON public.credit_transactions;
CREATE POLICY "credit_tx_own_select" ON public.credit_transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- new user bootstrap
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)), NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_credits (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- NEVER block sign-up / OAuth sign-in. Any failure here (missing table,
  -- column mismatch, permission problem) would otherwise surface to the user
  -- as "Database error saving new user" and abort the auth insert. The app
  -- also bootstraps profile + credits server-side (ensureAccount), so a skip
  -- here is self-healing on the next authenticated request.
  RAISE WARNING 'handle_new_user skipped for %: % (%)', NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- atomic credit spend with automatic 24h reset
CREATE OR REPLACE FUNCTION public.spend_credits(_user_id uuid, _amount integer, _reason text, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (ok boolean, balance integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur public.user_credits%ROWTYPE;
BEGIN
  IF _amount <= 0 THEN RAISE EXCEPTION 'invalid amount'; END IF;
  INSERT INTO public.user_credits (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO cur FROM public.user_credits WHERE user_id = _user_id FOR UPDATE;
  IF cur.resets_at <= now() THEN
    UPDATE public.user_credits SET balance = daily_allowance, resets_at = now() + interval '24 hours', updated_at = now()
    WHERE user_id = _user_id RETURNING * INTO cur;
  END IF;
  IF cur.balance < _amount THEN
    RETURN QUERY SELECT false, cur.balance; RETURN;
  END IF;
  UPDATE public.user_credits SET balance = balance - _amount, updated_at = now() WHERE user_id = _user_id RETURNING * INTO cur;
  INSERT INTO public.credit_transactions (user_id, delta, reason, metadata) VALUES (_user_id, -_amount, _reason, _metadata);
  RETURN QUERY SELECT true, cur.balance;
END; $$;
REVOKE ALL ON FUNCTION public.spend_credits(uuid,integer,text,jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spend_credits(uuid,integer,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.refund_credits(_user_id uuid, _amount integer, _reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b integer;
BEGIN
  UPDATE public.user_credits SET balance = LEAST(balance + _amount, daily_allowance), updated_at = now()
  WHERE user_id = _user_id RETURNING balance INTO b;
  INSERT INTO public.credit_transactions (user_id, delta, reason) VALUES (_user_id, _amount, _reason);
  RETURN b;
END; $$;
REVOKE ALL ON FUNCTION public.refund_credits(uuid,integer,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credits(uuid,integer,text) TO service_role;

CREATE OR REPLACE FUNCTION public.reset_expired_credits() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  UPDATE public.user_credits SET balance = daily_allowance, resets_at = now() + interval '24 hours', updated_at = now()
  WHERE resets_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.reset_expired_credits() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_expired_credits() TO service_role;

-- ============ guest usage (server-side enforced) ============
CREATE TABLE IF NOT EXISTS public.guest_usage (
  visitor_hash text PRIMARY KEY,
  message_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.guest_usage TO service_role;
ALTER TABLE public.guest_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "guest_usage_no_client_access" ON public.guest_usage;
CREATE POLICY "guest_usage_no_client_access" ON public.guest_usage FOR SELECT TO authenticated USING (false);

CREATE OR REPLACE FUNCTION public.consume_guest_message(_hash text, _limit integer DEFAULT 3)
RETURNS TABLE (allowed boolean, used integer, remaining integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE row public.guest_usage%ROWTYPE;
BEGIN
  INSERT INTO public.guest_usage (visitor_hash) VALUES (_hash) ON CONFLICT (visitor_hash) DO NOTHING;
  SELECT * INTO row FROM public.guest_usage WHERE visitor_hash = _hash FOR UPDATE;
  IF row.window_started_at <= now() - interval '24 hours' THEN
    UPDATE public.guest_usage SET message_count = 0, window_started_at = now(), updated_at = now()
    WHERE visitor_hash = _hash RETURNING * INTO row;
  END IF;
  IF row.message_count >= _limit THEN
    RETURN QUERY SELECT false, row.message_count, 0; RETURN;
  END IF;
  UPDATE public.guest_usage SET message_count = message_count + 1, updated_at = now()
  WHERE visitor_hash = _hash RETURNING * INTO row;
  RETURN QUERY SELECT true, row.message_count, GREATEST(_limit - row.message_count, 0);
END; $$;
REVOKE ALL ON FUNCTION public.consume_guest_message(text,integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_guest_message(text,integer) TO service_role;

-- ============ durable rate limiting ============
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  bucket       text        NOT NULL,
  subject      text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, subject, window_start)
);
GRANT ALL ON public.api_rate_limits TO service_role;
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rate_limits_no_client_access" ON public.api_rate_limits;
CREATE POLICY "rate_limits_no_client_access"
  ON public.api_rate_limits FOR SELECT TO authenticated USING (false);
CREATE INDEX IF NOT EXISTS api_rate_limits_window_idx
  ON public.api_rate_limits (window_start);

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  _bucket text,
  _subject text,
  _limit integer,
  _window_seconds integer
)
RETURNS TABLE (allowed boolean, remaining integer, retry_after integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _window integer := GREATEST(_window_seconds, 1);
  _start timestamptz;
  _count integer;
BEGIN
  _start := to_timestamp(floor(extract(epoch FROM now()) / _window) * _window);

  INSERT INTO public.api_rate_limits AS r (bucket, subject, window_start, count)
  VALUES (_bucket, _subject, _start, 1)
  ON CONFLICT (bucket, subject, window_start)
  DO UPDATE SET count = r.count + 1
  RETURNING r.count INTO _count;

  IF random() < 0.01 THEN
    DELETE FROM public.api_rate_limits WHERE window_start < now() - interval '2 days';
  END IF;

  allowed := _count <= _limit;
  remaining := GREATEST(_limit - _count, 0);
  retry_after := GREATEST(
    CEIL(EXTRACT(epoch FROM (_start + make_interval(secs => _window)) - now()))::integer,
    1
  );
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_rate_limit(text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text,text,integer,integer) TO service_role;

-- ============ conversations & messages ============
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  surface text NOT NULL DEFAULT 'chat',
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS surface text NOT NULL DEFAULT 'chat';
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS conversations_user_idx ON public.conversations(user_id, updated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "conv_own_all" ON public.conversations;
CREATE POLICY "conv_own_all" ON public.conversations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS conversations_updated_at ON public.conversations;
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS messages_conv_idx ON public.messages(conversation_id, created_at);
GRANT SELECT, INSERT, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "msg_own_select" ON public.messages;
CREATE POLICY "msg_own_select" ON public.messages FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "msg_own_insert" ON public.messages;
CREATE POLICY "msg_own_insert" ON public.messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "msg_own_delete" ON public.messages;
CREATE POLICY "msg_own_delete" ON public.messages FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============ library ============
CREATE TABLE IF NOT EXISTS public.library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  kind text NOT NULL DEFAULT 'file',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS library_user_idx ON public.library_items(user_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.library_items TO authenticated;
GRANT ALL ON public.library_items TO service_role;
ALTER TABLE public.library_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "library_own_all" ON public.library_items;
CREATE POLICY "library_own_all" ON public.library_items FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ research ============
CREATE TABLE IF NOT EXISTS public.research_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'general',
  query text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS research_user_idx ON public.research_records(user_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.research_records TO authenticated;
GRANT ALL ON public.research_records TO service_role;
ALTER TABLE public.research_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "research_own_all" ON public.research_records;
CREATE POLICY "research_own_all" ON public.research_records FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ generated media ============
CREATE TABLE IF NOT EXISTS public.generated_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_type text NOT NULL CHECK (media_type IN ('image','video','audio')),
  prompt text NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  storage_path text,
  external_url text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_user_idx ON public.generated_media(user_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.generated_media TO authenticated;
GRANT ALL ON public.generated_media TO service_role;
ALTER TABLE public.generated_media ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "media_own_all" ON public.generated_media;
CREATE POLICY "media_own_all" ON public.generated_media FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ subscriptions ============
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'inactive',
  provider text,
  provider_subscription_id text,
  currency text NOT NULL DEFAULT 'INR',
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subs_own_select" ON public.subscriptions;
CREATE POLICY "subs_own_select" ON public.subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ audit logs (append only) ============
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_user_idx ON public.audit_logs(user_id, created_at DESC);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_own_select" ON public.audit_logs;
CREATE POLICY "audit_own_select" ON public.audit_logs FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ============ payment webhook idempotency ledger ============
CREATE TABLE IF NOT EXISTS public.processed_webhook_events (
  id text PRIMARY KEY,
  provider text NOT NULL DEFAULT 'razorpay',
  event text NOT NULL DEFAULT '',
  user_id uuid,
  processed_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.processed_webhook_events TO service_role;
ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: RLS then denies every non-service-role request.

REVOKE ALL ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM public, anon, authenticated;

-- ============ storage: private per-user library bucket ============
INSERT INTO storage.buckets (id, name, public)
VALUES ('library', 'library', false)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "library_read_own" ON storage.objects;
CREATE POLICY "library_read_own" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'library' AND auth.uid()::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS "library_insert_own" ON storage.objects;
CREATE POLICY "library_insert_own" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'library' AND auth.uid()::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS "library_delete_own" ON storage.objects;
CREATE POLICY "library_delete_own" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'library' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Refresh the Data API schema cache so PostgREST sees the new functions.
NOTIFY pgrst, 'reload schema';

-- ============ PRODUCTION HARDENING ============
INSERT INTO storage.buckets (id, name, public)
VALUES ('library', 'library', false)
ON CONFLICT (id) DO UPDATE SET public = false;

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
CREATE POLICY "payment_orders_own_select" ON public.payment_orders FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.payment_orders TO authenticated;
GRANT ALL ON public.payment_orders TO service_role;

CREATE OR REPLACE FUNCTION public.refund_credits(_user_id uuid, _amount integer, _reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b integer;
BEGIN
  IF _amount <= 0 THEN RAISE EXCEPTION 'invalid refund amount'; END IF;
  INSERT INTO public.user_credits (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.user_credits AS uc
  SET balance = LEAST(uc.balance + _amount, uc.daily_allowance), updated_at = now()
  WHERE uc.user_id = _user_id RETURNING uc.balance INTO b;
  IF b IS NULL THEN RAISE EXCEPTION 'credit account not found'; END IF;
  INSERT INTO public.credit_transactions (user_id, delta, reason) VALUES (_user_id, _amount, _reason);
  RETURN b;
END; $$;
REVOKE ALL ON FUNCTION public.refund_credits(uuid,integer,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credits(uuid,integer,text) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_video_and_refund(_media_id uuid, _user_id uuid, _amount integer, _reason text)
RETURNS TABLE (handled boolean, balance integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b integer;
BEGIN
  UPDATE public.generated_media SET status = 'failed'
  WHERE id = _media_id AND user_id = _user_id AND media_type = 'video' AND status = 'processing';
  IF NOT FOUND THEN
    SELECT uc.balance INTO b FROM public.user_credits AS uc WHERE uc.user_id = _user_id;
    RETURN QUERY SELECT false, COALESCE(b, 0); RETURN;
  END IF;
  INSERT INTO public.user_credits (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.user_credits AS uc
  SET balance = LEAST(uc.balance + _amount, uc.daily_allowance), updated_at = now()
  WHERE uc.user_id = _user_id RETURNING uc.balance INTO b;
  IF b IS NULL THEN RAISE EXCEPTION 'credit account not found'; END IF;
  INSERT INTO public.credit_transactions (user_id, delta, reason) VALUES (_user_id, _amount, _reason);
  RETURN QUERY SELECT true, b;
END; $$;
REVOKE ALL ON FUNCTION public.fail_video_and_refund(uuid,uuid,integer,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_video_and_refund(uuid,uuid,integer,text) TO service_role;

CREATE OR REPLACE FUNCTION public.release_guest_message(_hash text)
RETURNS TABLE (used integer, remaining integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE row public.guest_usage%ROWTYPE;
BEGIN
  SELECT * INTO row FROM public.guest_usage WHERE visitor_hash = _hash FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 0, 3; RETURN; END IF;
  UPDATE public.guest_usage SET message_count = GREATEST(message_count - 1, 0), updated_at = now()
  WHERE visitor_hash = _hash RETURNING * INTO row;
  RETURN QUERY SELECT row.message_count, GREATEST(3 - row.message_count, 0);
END; $$;
REVOKE ALL ON FUNCTION public.release_guest_message(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_guest_message(text) TO service_role;

CREATE OR REPLACE FUNCTION public.process_razorpay_webhook(
  _event_id text, _event text, _user_id uuid, _plan_id text, _currency text,
  _provider_order_id text, _period_days integer, _is_success boolean
)
RETURNS TABLE (status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inserted_count integer; actual_order public.payment_orders%ROWTYPE; period_end timestamptz;
BEGIN
  IF _event_id IS NULL OR length(trim(_event_id)) = 0 THEN RAISE EXCEPTION 'missing event id'; END IF;
  INSERT INTO public.processed_webhook_events(id, provider, event, user_id)
  VALUES (_event_id, 'razorpay', _event, _user_id) ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count = 0 THEN RETURN QUERY SELECT 'duplicate'::text; RETURN; END IF;

  SELECT * INTO actual_order FROM public.payment_orders
  WHERE provider_order_id = _provider_order_id AND provider = 'razorpay' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown Razorpay order'; END IF;
  IF actual_order.user_id <> _user_id THEN RAISE EXCEPTION 'order user mismatch'; END IF;
  IF actual_order.plan_id <> _plan_id THEN RAISE EXCEPTION 'order plan mismatch'; END IF;
  IF actual_order.currency <> _currency THEN RAISE EXCEPTION 'order currency mismatch'; END IF;

  IF _is_success THEN
    IF _period_days <= 0 THEN RAISE EXCEPTION 'invalid subscription period'; END IF;
    period_end := now() + make_interval(days => _period_days);
    UPDATE public.payment_orders SET status = 'paid', paid_at = now() WHERE id = actual_order.id;
    INSERT INTO public.subscriptions(user_id, plan, status, currency, provider, provider_subscription_id, current_period_end, updated_at)
    VALUES (_user_id, _plan_id, 'active', _currency, 'razorpay', _provider_order_id, period_end, now())
    ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan, status = EXCLUDED.status, currency = EXCLUDED.currency,
      provider = EXCLUDED.provider, provider_subscription_id = EXCLUDED.provider_subscription_id,
      current_period_end = EXCLUDED.current_period_end, updated_at = now();
    INSERT INTO public.audit_logs(user_id, event, details)
    VALUES (_user_id, 'subscription_activated', jsonb_build_object('plan', _plan_id, 'event', _event, 'order_id', _provider_order_id));
  ELSE
    UPDATE public.payment_orders SET status = 'failed' WHERE id = actual_order.id;
    UPDATE public.subscriptions SET status = 'past_due', updated_at = now() WHERE user_id = _user_id;
    INSERT INTO public.audit_logs(user_id, event, details)
    VALUES (_user_id, 'subscription_state_changed', jsonb_build_object('event', _event, 'order_id', _provider_order_id));
  END IF;
  RETURN QUERY SELECT 'processed'::text;
END; $$;
REVOKE ALL ON FUNCTION public.process_razorpay_webhook(text,text,uuid,text,text,text,integer,boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_razorpay_webhook(text,text,uuid,text,text,text,integer,boolean) TO service_role;

DROP POLICY IF EXISTS "msg_own_insert" ON public.messages;
CREATE POLICY "msg_own_insert" ON public.messages FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND EXISTS (
  SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()
));

-- Corrected spend_credits: qualify balance to avoid PL/pgSQL OUT-parameter ambiguity.
CREATE OR REPLACE FUNCTION public.spend_credits(_user_id uuid, _amount integer, _reason text, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (ok boolean, balance integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur public.user_credits%ROWTYPE;
BEGIN
  IF _amount <= 0 THEN RAISE EXCEPTION 'invalid amount'; END IF;
  INSERT INTO public.user_credits (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO cur FROM public.user_credits WHERE user_id = _user_id FOR UPDATE;
  IF cur.resets_at <= now() THEN
    UPDATE public.user_credits
    SET balance = daily_allowance, resets_at = now() + interval '24 hours', updated_at = now()
    WHERE user_id = _user_id RETURNING * INTO cur;
  END IF;
  IF cur.balance < _amount THEN
    RETURN QUERY SELECT false, cur.balance; RETURN;
  END IF;
  UPDATE public.user_credits AS uc
  SET balance = uc.balance - _amount, updated_at = now()
  WHERE uc.user_id = _user_id RETURNING uc.* INTO cur;
  INSERT INTO public.credit_transactions (user_id, delta, reason, metadata)
  VALUES (_user_id, -_amount, _reason, _metadata);
  RETURN QUERY SELECT true, cur.balance;
END; $$;
REVOKE ALL ON FUNCTION public.spend_credits(uuid,integer,text,jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spend_credits(uuid,integer,text,jsonb) TO service_role;
