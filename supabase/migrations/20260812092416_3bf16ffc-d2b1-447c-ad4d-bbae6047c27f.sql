
-- ============ helpers ============
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============ profiles ============
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  region text NOT NULL DEFAULT 'IN',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_own_select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_own_insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_own_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ credits ============
CREATE TABLE public.user_credits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 10,
  daily_allowance integer NOT NULL DEFAULT 10,
  resets_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_credits TO authenticated;
GRANT ALL ON public.user_credits TO service_role;
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "credits_own_select" ON public.user_credits FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta integer NOT NULL,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_tx_user_idx ON public.credit_transactions(user_id, created_at DESC);
GRANT SELECT ON public.credit_transactions TO authenticated;
GRANT ALL ON public.credit_transactions TO service_role;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
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
END; $$;
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

-- daily reset job target
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
CREATE TABLE public.guest_usage (
  visitor_hash text PRIMARY KEY,
  message_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.guest_usage TO service_role;
ALTER TABLE public.guest_usage ENABLE ROW LEVEL SECURITY;

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

-- ============ conversations ============
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  surface text NOT NULL DEFAULT 'chat',
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_user_idx ON public.conversations(user_id, updated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conv_own_all" ON public.conversations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conv_idx ON public.messages(conversation_id, created_at);
GRANT SELECT, INSERT, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "msg_own_select" ON public.messages FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "msg_own_insert" ON public.messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "msg_own_delete" ON public.messages FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============ library ============
CREATE TABLE public.library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  kind text NOT NULL DEFAULT 'file',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX library_user_idx ON public.library_items(user_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.library_items TO authenticated;
GRANT ALL ON public.library_items TO service_role;
ALTER TABLE public.library_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "library_own_all" ON public.library_items FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ research ============
CREATE TABLE public.research_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'general',
  query text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX research_user_idx ON public.research_records(user_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.research_records TO authenticated;
GRANT ALL ON public.research_records TO service_role;
ALTER TABLE public.research_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "research_own_all" ON public.research_records FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ generated media ============
CREATE TABLE public.generated_media (
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
CREATE INDEX media_user_idx ON public.generated_media(user_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.generated_media TO authenticated;
GRANT ALL ON public.generated_media TO service_role;
ALTER TABLE public.generated_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "media_own_all" ON public.generated_media FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ subscriptions ============
CREATE TABLE public.subscriptions (
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
CREATE POLICY "subs_own_select" ON public.subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ audit logs (append only) ============
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_user_idx ON public.audit_logs(user_id, created_at DESC);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_own_select" ON public.audit_logs FOR SELECT TO authenticated USING (auth.uid() = user_id);
