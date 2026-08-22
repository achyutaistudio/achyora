-- spend_credits declared an OUT column named `balance`, which shadowed the
-- user_credits.balance column inside the function body and made the UPDATE
-- fail with: column reference "balance" is ambiguous.
CREATE OR REPLACE FUNCTION public.spend_credits(_user_id uuid, _amount integer, _reason text, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (ok boolean, balance integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur public.user_credits%ROWTYPE;
BEGIN
  IF _amount <= 0 THEN RAISE EXCEPTION 'invalid amount'; END IF;
  INSERT INTO public.user_credits (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO cur FROM public.user_credits WHERE user_id = _user_id FOR UPDATE;
  IF cur.resets_at <= now() THEN
    UPDATE public.user_credits AS uc SET balance = uc.daily_allowance, resets_at = now() + interval '24 hours', updated_at = now()
    WHERE uc.user_id = _user_id RETURNING uc.* INTO cur;
  END IF;
  IF cur.balance < _amount THEN
    RETURN QUERY SELECT false, cur.balance; RETURN;
  END IF;
  UPDATE public.user_credits AS uc SET balance = uc.balance - _amount, updated_at = now()
  WHERE uc.user_id = _user_id RETURNING uc.* INTO cur;
  INSERT INTO public.credit_transactions (user_id, delta, reason, metadata) VALUES (_user_id, -_amount, _reason, _metadata);
  RETURN QUERY SELECT true, cur.balance;
END; $$;
REVOKE ALL ON FUNCTION public.spend_credits(uuid,integer,text,jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spend_credits(uuid,integer,text,jsonb) TO service_role;
