
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS clock_in_lat numeric,
  ADD COLUMN IF NOT EXISTS clock_in_lng numeric,
  ADD COLUMN IF NOT EXISTS clock_in_address text,
  ADD COLUMN IF NOT EXISTS clock_out_lat numeric,
  ADD COLUMN IF NOT EXISTS clock_out_lng numeric,
  ADD COLUMN IF NOT EXISTS clock_out_address text;

CREATE OR REPLACE FUNCTION public.punch_clock(
  p_pin text,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_address text DEFAULT NULL
)
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
  v_in_threshold timestamp := v_date + time '07:30';
  v_out_threshold timestamp;
  v_late_min integer := 0;
  v_early_min integer := 0;
  v_deduct_pct numeric := 0;
  v_extra_pct numeric := 0;
  v_ontime boolean := true;
  v_row public.attendance%ROWTYPE;
  v_action text;
BEGIN
  IF p_pin IS NULL OR length(p_pin) <> 4 OR p_pin !~ '^[0-9]{4}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PIN must be 4 digits');
  END IF;

  SELECT * INTO v_staff FROM public.staff WHERE pin = p_pin AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid PIN');
  END IF;

  v_out_threshold := v_date + CASE WHEN v_staff.department = 'nursery'
    THEN time '12:40' ELSE time '13:10' END;

  SELECT * INTO v_row FROM public.attendance WHERE staff_id = v_staff.id AND work_date = v_date;

  IF NOT FOUND THEN
    IF v_local > v_in_threshold THEN
      v_late_min := CEIL(EXTRACT(EPOCH FROM (v_local - v_in_threshold))/60)::int;
      v_deduct_pct := LEAST(CEIL(v_late_min::numeric / 10) * 5, 100);
      v_ontime := false;
    END IF;
    INSERT INTO public.attendance (staff_id, work_date, clock_in, late_minutes, deduction_amount, on_time, clock_in_lat, clock_in_lng, clock_in_address)
    VALUES (v_staff.id, v_date, v_now, v_late_min, v_deduct_pct, v_ontime, p_lat, p_lng, p_address)
    RETURNING * INTO v_row;
    v_action := 'in';
  ELSIF v_row.clock_out IS NULL THEN
    IF v_local < v_out_threshold THEN
      v_early_min := CEIL(EXTRACT(EPOCH FROM (v_out_threshold - v_local))/60)::int;
      v_extra_pct := LEAST(CEIL(v_early_min::numeric / 10) * 5, 100);
    END IF;
    UPDATE public.attendance
       SET clock_out = v_now,
           deduction_amount = LEAST(deduction_amount + v_extra_pct, 100),
           clock_out_lat = p_lat,
           clock_out_lng = p_lng,
           clock_out_address = p_address
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
    'lat', COALESCE(p_lat, CASE WHEN v_action='in' THEN v_row.clock_in_lat ELSE v_row.clock_out_lat END),
    'lng', COALESCE(p_lng, CASE WHEN v_action='in' THEN v_row.clock_in_lng ELSE v_row.clock_out_lng END),
    'address', COALESCE(p_address, CASE WHEN v_action='in' THEN v_row.clock_in_address ELSE v_row.clock_out_address END)
  );
END;
$function$;
