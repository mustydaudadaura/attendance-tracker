CREATE OR REPLACE FUNCTION public.punch_clock(p_pin text)
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
    INSERT INTO public.attendance (staff_id, work_date, clock_in, late_minutes, deduction_amount, on_time)
    VALUES (v_staff.id, v_date, v_now, v_late_min, v_deduct_pct, v_ontime)
    RETURNING * INTO v_row;
    v_action := 'in';
  ELSIF v_row.clock_out IS NULL THEN
    IF v_local < v_out_threshold THEN
      v_early_min := CEIL(EXTRACT(EPOCH FROM (v_out_threshold - v_local))/60)::int;
      v_extra_pct := LEAST(CEIL(v_early_min::numeric / 10) * 5, 100);
    END IF;
    UPDATE public.attendance
       SET clock_out = v_now,
           deduction_amount = LEAST(deduction_amount + v_extra_pct, 100)
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
    'on_time', v_row.on_time
  );
END;
$function$;