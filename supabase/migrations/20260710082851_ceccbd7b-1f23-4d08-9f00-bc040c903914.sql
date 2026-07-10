
CREATE TABLE IF NOT EXISTS public.geofence_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  staff_name text,
  department text,
  lat numeric,
  lng numeric,
  distance_m numeric,
  radius_m integer,
  on_site boolean,
  allowed boolean NOT NULL,
  action text,
  error_message text
);

GRANT SELECT ON public.geofence_attempts TO authenticated;
GRANT ALL ON public.geofence_attempts TO service_role;

ALTER TABLE public.geofence_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin read geofence attempts"
  ON public.geofence_attempts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_geofence_attempts_attempted_at
  ON public.geofence_attempts (attempted_at DESC);

-- Replace punch_clock to log geofence attempts
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
  v_err text;
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

  SELECT * INTO v_settings FROM public.site_settings WHERE id = true;
  IF FOUND AND v_settings.site_lat IS NOT NULL AND v_settings.site_lng IS NOT NULL THEN
    IF p_lat IS NULL OR p_lng IS NULL THEN
      v_err := 'Location is required. Please allow location access and try again.';
      INSERT INTO public.geofence_attempts (staff_id, staff_name, department, lat, lng, distance_m, radius_m, on_site, allowed, error_message)
      VALUES (v_staff.id, v_staff.full_name, v_staff.department::text, NULL, NULL, NULL, v_settings.radius_meters, NULL, false, v_err);
      RETURN jsonb_build_object('ok', false, 'error', v_err);
    END IF;
    v_dist := public.haversine_m(p_lat, p_lng, v_settings.site_lat, v_settings.site_lng);
    v_on_site := v_dist <= v_settings.radius_meters;
    IF NOT v_on_site THEN
      v_err := 'You are ' || round(v_dist)::text || 'm from ' || v_settings.site_label ||
               '. You must be within ' || v_settings.radius_meters::text || 'm to clock in/out.';
      INSERT INTO public.geofence_attempts (staff_id, staff_name, department, lat, lng, distance_m, radius_m, on_site, allowed, error_message)
      VALUES (v_staff.id, v_staff.full_name, v_staff.department::text, p_lat, p_lng, v_dist, v_settings.radius_meters, false, false, v_err);
      RETURN jsonb_build_object(
        'ok', false, 'error', v_err,
        'distance_m', round(v_dist), 'radius_m', v_settings.radius_meters, 'on_site', false
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
           clock_out_lat = p_lat, clock_out_lng = p_lng, clock_out_address = p_address,
           clock_out_on_site = v_on_site, clock_out_distance_m = v_dist
     WHERE id = v_row.id
     RETURNING * INTO v_row;
    v_action := 'out';
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'Already clocked in and out today');
  END IF;

  -- Log successful geofenced attempt
  IF v_on_site IS NOT NULL THEN
    INSERT INTO public.geofence_attempts (staff_id, staff_name, department, lat, lng, distance_m, radius_m, on_site, allowed, action)
    VALUES (v_staff.id, v_staff.full_name, v_staff.department::text, p_lat, p_lng, v_dist, (SELECT radius_meters FROM public.site_settings WHERE id = true), v_on_site, true, v_action);
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'action', v_action,
    'staff_name', v_staff.full_name, 'department', v_staff.department,
    'clock_in', v_row.clock_in, 'clock_out', v_row.clock_out,
    'late_minutes', v_row.late_minutes, 'early_minutes', v_early_min,
    'deduction_percent', v_row.deduction_amount, 'on_time', v_row.on_time,
    'lat', p_lat, 'lng', p_lng, 'address', p_address,
    'on_site', v_on_site,
    'distance_m', CASE WHEN v_dist IS NULL THEN NULL ELSE round(v_dist) END
  );
END;
$function$;
