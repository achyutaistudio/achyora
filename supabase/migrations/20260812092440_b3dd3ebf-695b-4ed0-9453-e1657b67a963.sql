
REVOKE ALL ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM public, anon, authenticated;
CREATE POLICY "guest_usage_no_client_access" ON public.guest_usage FOR SELECT TO authenticated USING (false);
