REVOKE EXECUTE ON FUNCTION public.grant_admin_for_designated_email() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.daily_penalty_summary(date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
