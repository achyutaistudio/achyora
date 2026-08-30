-- ACHYORA — durable, multi-instance rate limiting.
--
-- Rate limiting must survive across serverless instances, so the counter lives
-- in Postgres rather than in per-process memory. The guest quota
-- (3 messages / 24h) is a SEPARATE control and stays in public.guest_usage.
--
-- Apply once against the production database (Supabase SQL editor or
-- `supabase db push`). Safe to re-run.

CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  bucket       text        NOT NULL,
  subject      text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, subject, window_start)
);

-- No anon/authenticated grants: the browser must never read or write this.
GRANT ALL ON public.api_rate_limits TO service_role;

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rate_limits_no_client_access" ON public.api_rate_limits;
CREATE POLICY "rate_limits_no_client_access"
  ON public.api_rate_limits FOR SELECT TO authenticated USING (false);

CREATE INDEX IF NOT EXISTS api_rate_limits_window_idx
  ON public.api_rate_limits (window_start);

-- Atomic consume: one round trip, correct under concurrency.
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

  -- Opportunistic cleanup of long-expired windows.
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
