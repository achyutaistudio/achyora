-- ACHYORA — fix "Database error saving new user" on sign-up / Google sign-in.
--
-- CAUSE
-- The AFTER INSERT trigger on auth.users (public.handle_new_user) runs inside
-- the same transaction as the auth insert. Any error it raises (missing
-- public.user_credits, an added NOT NULL column on public.profiles, missing
-- privileges) aborts the user creation, and Supabase Auth reports it as
-- "Database error saving new user" — which is exactly what the OAuth callback
-- receives as error_code=unexpected_failure.
--
-- FIX
-- Make the bootstrap trigger non-fatal. Profile + credits are still created
-- here when possible; if anything fails, sign-up succeeds and the app's own
-- idempotent server-side bootstrap (ensureAccount) creates the rows on the
-- first authenticated request.
--
-- HOW TO APPLY (fixes every environment, not just local)
-- Supabase Dashboard -> SQL Editor -> paste this file -> Run.
-- Idempotent and safe to re-run; no data is dropped.

-- Make sure the tables the trigger writes to exist with the expected shape.
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  region text NOT NULL DEFAULT 'IN',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

CREATE TABLE IF NOT EXISTS public.user_credits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 10,
  daily_allowance integer NOT NULL DEFAULT 10,
  resets_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_credits TO authenticated;
GRANT ALL ON public.user_credits TO service_role;

-- Fault-tolerant bootstrap trigger.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(COALESCE(NEW.email, ''), '@', 1)
    ),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture')
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_credits (user_id) VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user skipped for %: % (%)', NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

REVOKE ALL ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;

-- Backfill anyone who signed up while the trigger was failing.
INSERT INTO public.profiles (id, display_name, avatar_url)
SELECT u.id,
       COALESCE(u.raw_user_meta_data->>'display_name', u.raw_user_meta_data->>'full_name',
                u.raw_user_meta_data->>'name', split_part(COALESCE(u.email, ''), '@', 1)),
       COALESCE(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture')
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_credits (user_id)
SELECT u.id FROM auth.users u
LEFT JOIN public.user_credits c ON c.user_id = u.id
WHERE c.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;
