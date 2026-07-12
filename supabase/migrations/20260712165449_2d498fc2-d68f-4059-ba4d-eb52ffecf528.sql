-- 1. Drop permissive anon-read policies and revoke role grants
DROP POLICY IF EXISTS "anyone can read site settings" ON public.site_settings;
DROP POLICY IF EXISTS "anyone can read holidays" ON public.holidays;

REVOKE SELECT ON public.site_settings FROM anon, PUBLIC;
REVOKE SELECT ON public.holidays FROM anon, PUBLIC;

-- Keep authenticated admins working through their admin policies. Ensure grants remain.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holidays TO authenticated;
GRANT ALL ON public.site_settings TO service_role;
GRANT ALL ON public.holidays TO service_role;

-- 2. Kiosk-safe RPC: returns radius/label and, when GPS is provided, the
-- computed distance and on_site flag — but NEVER the site coordinates.
CREATE OR REPLACE FUNCTION public.get_kiosk_site_info(p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s public.site_settings%ROWTYPE;
  v_dist numeric;
BEGIN
  SELECT * INTO s FROM public.site_settings WHERE id = true;
  IF NOT FOUND OR s.site_lat IS NULL OR s.site_lng IS NULL THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN jsonb_build_object(
      'enabled', true,
      'radius_meters', s.radius_meters,
      'site_label', s.site_label
    );
  END IF;
  v_dist := public.haversine_m(p_lat, p_lng, s.site_lat, s.site_lng);
  RETURN jsonb_build_object(
    'enabled', true,
    'radius_meters', s.radius_meters,
    'site_label', s.site_label,
    'distance_m', round(v_dist),
    'on_site', v_dist <= s.radius_meters
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_kiosk_site_info(numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_kiosk_site_info(numeric, numeric) TO anon, authenticated;

-- 3. Kiosk-safe RPC: label of today's holiday if any, else NULL.
CREATE OR REPLACE FUNCTION public.get_todays_holiday()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT label FROM public.holidays
   WHERE work_date = ((now() AT TIME ZONE 'Africa/Lagos')::date)
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_todays_holiday() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_todays_holiday() TO anon, authenticated;
