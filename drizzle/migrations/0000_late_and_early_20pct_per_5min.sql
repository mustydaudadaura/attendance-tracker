-- 20% per every 5 minutes late at sign-in and early at sign-out (capped at 100%)
CREATE OR REPLACE FUNCTION public.punch_clock(p_pin text, p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL, p_address text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_sites_count int;
  v_best record;
  v_legacy public.site_settings%ROWTYPE;
  v_dist numeric := NULL;
  v_on_site boolean := NULL;
  v_radius int := NULL;
  v_label text := NULL;
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

  SELECT count(*) INTO v_sites_count FROM public.sites WHERE active = true;

  IF v_sites_count > 0 THEN
    IF p_lat IS NULL OR p_lng IS NULL THEN
      v_err := 'Location is required. Please allow location access and try again.';
      INSERT INTO public.geofence_attempts (staff_id, staff_name, department, lat, lng, distance_m, radius_m, on_site, allowed, error_message)
      VALUES (v_staff.id, v_staff.full_name, v_staff.department::text, NULL, NULL, NULL, NULL, NULL, false, v_err);
      RETURN jsonb_build_object('ok', false, 'error', v_err);
    END IF;

    SELECT site_label, radius_meters,
           public.haversine_m(p_lat, p_lng, site_lat, site_lng) AS dist
      INTO v_best
      FROM public.sites
     WHERE active = true
     ORDER BY public.haversine_m(p_lat, p_lng, site_lat, site_lng) ASC
     LIMIT 1;

    v_dist := v_best.dist;
    v_radius := v_best.radius_meters;
    v_label := v_best.site_label;
    v_on_site := v_dist <= v_radius;

    IF NOT v_on_site THEN
      v_err := 'You are ' || round(v_dist)::text || 'm from the nearest school (' || v_label ||
               '). You must be within ' || v_radius::text || 'm to clock in/out.';
      INSERT INTO public.geofence_attempts (staff_id, staff_name, department, lat, lng, distance_m, radius_m, on_site, allowed, error_message)
      VALUES (v_staff.id, v_staff.full_name, v_staff.department::text, p_lat, p_lng, v_dist, v_radius, false, false, v_err);
      RETURN jsonb_build_object('ok', false, 'error', v_err, 'distance_m', round(v_dist), 'radius_m', v_radius, 'on_site', false);
    END IF;
  ELSE
    SELECT * INTO v_legacy FROM public.site_settings WHERE id = true;
    IF FOUND AND v_legacy.site_lat IS NOT NULL AND v_legacy.site_lng IS NOT NULL THEN
      IF p_lat IS NULL OR p_lng IS NULL THEN
        v_err := 'Location is required. Please allow location access and try again.';
        INSERT INTO public.geofence_attempts (staff_id, staff_name, department, lat, lng, distance_m, radius_m, on_site, allowed, error_message)
        VALUES (v_staff.id, v_staff.full_name, v_staff.department::text, NULL, NULL, NULL, v_legacy.radius_meters, NULL, false, v_err);
        RETURN jsonb_build_object('ok', false, 'error', v_err);
      END IF;
      v_dist := public.haversine_m(p_lat, p_lng, v_legacy.site_lat, v_legacy.site_lng);
      v_radius := v_legacy.radius_meters;
      v_label := v_legacy.site_label;
      v_on_site := v_dist <= v_radius;
      IF NOT v_on_site THEN
        v_err := 'You are ' || round(v_dist)::text || 'm from ' || v_label ||
                 '. You must be within ' || v_radius::text || 'm to clock in/out.';
        INSERT INTO public.geofence_attempts (staff_id, staff_name, department, lat, lng, distance_m, radius_m, on_site, allowed, error_message)
        VALUES (v_staff.id, v_staff.full_name, v_staff.department::text, p_lat, p_lng, v_dist, v_radius, false, false, v_err);
        RETURN jsonb_build_object('ok', false, 'error', v_err, 'distance_m', round(v_dist), 'radius_m', v_radius, 'on_site', false);
      END IF;
    END IF;
  END IF;

  v_out_threshold := v_date + CASE WHEN v_staff.department = 'nursery'
    THEN time '12:40' ELSE time '13:10' END;

  SELECT * INTO v_row FROM public.attendance WHERE staff_id = v_staff.id AND work_date = v_date;

  IF NOT FOUND THEN
    IF v_local > v_in_threshold THEN
      v_late_min := CEIL(EXTRACT(EPOCH FROM (v_local - v_in_threshold))/60)::int;
      v_deduct_pct := LEAST(CEIL(v_late_min::numeric / 5) * 20, 100);
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
      v_extra_pct := LEAST(CEIL(v_early_min::numeric / 5) * 20, 100);
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

  IF v_on_site IS NOT NULL THEN
    INSERT INTO public.geofence_attempts (staff_id, staff_name, department, lat, lng, distance_m, radius_m, on_site, allowed, action)
    VALUES (v_staff.id, v_staff.full_name, v_staff.department::text, p_lat, p_lng, v_dist, v_radius, v_on_site, true, v_action);
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'action', v_action,
    'staff_name', v_staff.full_name, 'department', v_staff.department,
    'clock_in', v_row.clock_in, 'clock_out', v_row.clock_out,
    'late_minutes', v_row.late_minutes, 'early_minutes', v_early_min,
    'deduction_percent', v_row.deduction_amount, 'on_time', v_row.on_time,
    'lat', p_lat, 'lng', p_lng, 'address', p_address,
    'on_site', v_on_site,
    'site_label', v_label,
    'distance_m', CASE WHEN v_dist IS NULL THEN NULL ELSE round(v_dist) END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.punch_clock(text, numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.punch_clock(text, numeric, numeric, text) TO anon, authenticated;

-- Recalculate historical deduction percentages with the new 20%-per-5-minutes rule
WITH recalc AS (
  SELECT a.id,
         LEAST(
           COALESCE(CEIL(a.late_minutes::numeric / 5) * 20, 0)
           + CASE
               WHEN a.clock_out IS NOT NULL THEN
                 COALESCE(CEIL(GREATEST(EXTRACT(EPOCH FROM (
                   (a.work_date + CASE WHEN s.department = 'nursery' THEN time '12:40' ELSE time '13:10' END)
                   - (a.clock_out AT TIME ZONE 'Africa/Lagos')))/60, 0)::numeric / 5) * 20, 0)
               ELSE 0
             END,
           100) AS new_pct
  FROM public.attendance a
  JOIN public.staff s ON s.id = a.staff_id
)
UPDATE public.attendance a
   SET deduction_amount = r.new_pct
  FROM recalc r
 WHERE a.id = r.id AND a.deduction_amount IS DISTINCT FROM r.new_pct;