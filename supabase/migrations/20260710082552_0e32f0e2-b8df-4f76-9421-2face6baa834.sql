
-- Site settings singleton for geofence
CREATE TABLE IF NOT EXISTS public.site_settings (
  id boolean PRIMARY KEY DEFAULT true,
  site_lat numeric,
  site_lng numeric,
  radius_meters integer NOT NULL DEFAULT 150,
  site_label text NOT NULL DEFAULT 'School',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_settings_singleton CHECK (id = true)
);

GRANT SELECT ON public.site_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_settings TO authenticated;
GRANT ALL ON public.site_settings TO service_role;

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can read site settings"
  ON public.site_settings FOR SELECT TO public USING (true);
CREATE POLICY "admins manage site settings"
  ON public.site_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.site_settings (id, radius_meters) VALUES (true, 150)
  ON CONFLICT (id) DO NOTHING;

-- Add on_site flag + distance to attendance
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS clock_in_on_site boolean,
  ADD COLUMN IF NOT EXISTS clock_in_distance_m numeric,
  ADD COLUMN IF NOT EXISTS clock_out_on_site boolean,
  ADD COLUMN IF NOT EXISTS clock_out_distance_m numeric;

-- Haversine distance in meters
CREATE OR REPLACE FUNCTION public.haversine_m(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  r numeric := 6371000;
  dlat numeric;
  dlng numeric;
  a numeric;
BEGIN
  IF lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN
    RETURN NULL;
  END IF;
  dlat := radians(lat2 - lat1);
  dlng := radians(lng2 - lng1);
  a := sin(dlat/2)^2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng/2)^2;
  RETURN r * 2 * atan2(sqrt(a), sqrt(1-a));
END;
$$;

-- Replace punch_clock to compute on-site + block if outside geofence
CREATE OR REPLACE FUNCTION public.punch_clock(p_pin text, p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL, p_address text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_staff public.staff%ROWTYPE;
  v_now timestamptz := now();
  v_local timestamp := (v_now AT TIME ZONE 'Africa/Lagos');
  v_date date := v_local::date;
  v_dow int := EXTRACT(ISODOW FROM v_date)::int;
  v_holiday_label text;
  v_in_threshold timestamp := v_date + time '07:45';
  v_out_threshold timestamp;
  v_late_min integer := 0;
  v_early_min integer := 0;
  v_deduct_pct numeric := 0;
  v_extra_pct numeric := 0;
  v_ontime boolean := true;
  v_row public.attendance%ROWTYPE;
  v_action text;
  v_settings public.site_settings%ROWTYPE;
  v_dist numeric := NULL;
  v_on_site boolean := NULL;
BEGIN
  IF p_pin IS NULL OR length(p_pin) <> 4 OR p_pin !~ '^[0-9]{4}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PIN must be 4 digits');
  END IF;

  IF v_dow > 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sign-in is only allowed Monday to Friday');
  END IF;

  SELECT label INTO v_holiday_label FROM public.holidays WHERE work_date = v_date;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Today is a holiday (' || v_holiday_label || '). Sign-in is disabled.');
  END IF;

  SELECT * INTO v_staff FROM public.staff WHERE pin = p_pin AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid PIN');
  END IF;

  -- Geofence check
  SELECT * INTO v_settings FROM public.site_settings WHERE id = true;
  IF FOUND AND v_settings.site_lat IS NOT NULL AND v_settings.site_lng IS NOT NULL THEN
    IF p_lat IS NULL OR p_lng IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Location is required. Please allow location access and try again.');
    END IF;
    v_dist := public.haversine_m(p_lat, p_lng, v_settings.site_lat, v_settings.site_lng);
    v_on_site := v_dist <= v_settings.radius_meters;
    IF NOT v_on_site THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'You are ' || round(v_dist)::text || 'm from ' || v_settings.site_label ||
                 '. You must be within ' || v_settings.radius_meters::text || 'm to clock in/out.',
        'distance_m', round(v_dist),
        'radius_m', v_settings.radius_meters,
        'on_site', false
      );
    END IF;
  END IF;

  v_out_threshold := v_date + CASE WHEN v_staff.department = 'nursery'
    THEN time '12:40' ELSE time '13:10' END;

  SELECT * INTO v_row FROM public.attendance WHERE staff_id = v_staff.id AND work_date = v_date;

  IF NOT FOUND THEN
    IF v_local > v_in_threshold THEN
      v_late_min := CEIL(EXTRACT(EPOCH FROM (v_local - v_in_threshold))/60)::int;
      v_deduct_pct := LEAST(CEIL(v_late_min::numeric / 5) * 5, 100);
      v_ontime := false;
    END IF;
    INSERT INTO public.attendance (staff_id, work_date, clock_in, late_minutes, deduction_amount, on_time,
      clock_in_lat, clock_in_lng, clock_in_address, clock_in_on_site, clock_in_distance_m)
    VALUES (v_staff.id, v_date, v_now, v_late_min, v_deduct_pct, v_ontime,
      p_lat, p_lng, p_address, v_on_site, v_dist)
    RETURNING * INTO v_row;
    v_action := 'in';
  ELSIF v_row.clock_out IS NULL THEN
    IF v_local < v_out_threshold THEN
      v_early_min := CEIL(EXTRACT(EPOCH FROM (v_out_threshold - v_local))/60)::int;
      v_extra_pct := LEAST(CEIL(v_early_min::numeric / 5) * 5, 100);
    END IF;
    UPDATE public.attendance
       SET clock_out = v_now,
           deduction_amount = LEAST(deduction_amount + v_extra_pct, 100),
           clock_out_lat = p_lat,
           clock_out_lng = p_lng,
           clock_out_address = p_address,
           clock_out_on_site = v_on_site,
           clock_out_distance_m = v_dist
     WHERE id = v_row.id
     RETURNING * INTO v_row;
    v_action := 'out';
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'Already clocked in and out today');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'action', v_action,
    'staff_name', v_staff.full_name,
    'department', v_staff.department,
    'clock_in', v_row.clock_in,
    'clock_out', v_row.clock_out,
    'late_minutes', v_row.late_minutes,
    'early_minutes', v_early_min,
    'deduction_percent', v_row.deduction_amount,
    'on_time', v_row.on_time,
    'lat', p_lat,
    'lng', p_lng,
    'address', p_address,
    'on_site', v_on_site,
    'distance_m', CASE WHEN v_dist IS NULL THEN NULL ELSE round(v_dist) END
  );
END;
$function$;
