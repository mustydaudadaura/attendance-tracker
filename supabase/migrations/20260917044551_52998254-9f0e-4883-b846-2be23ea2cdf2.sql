DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.punch_clock(text,numeric,numeric,text)'::regprocedure)
    INTO v_definition;

  v_definition := replace(
    v_definition,
    'v_deduct_pct := LEAST(CEIL(v_late_min::numeric / 5) * 5, 100);',
    'v_deduct_pct := LEAST(FLOOR(EXTRACT(EPOCH FROM (v_local - v_in_threshold)) / 300) * 5, 100);'
  );
  v_definition := replace(
    v_definition,
    'v_extra_pct := LEAST(CEIL(v_early_min::numeric / 5) * 5, 100);',
    'v_extra_pct := LEAST(FLOOR(EXTRACT(EPOCH FROM (v_out_threshold - v_local)) / 300) * 5, 100);'
  );

  IF v_definition NOT LIKE '%FLOOR(EXTRACT(EPOCH FROM (v_local - v_in_threshold)) / 300) * 5%'
     OR v_definition NOT LIKE '%FLOOR(EXTRACT(EPOCH FROM (v_out_threshold - v_local)) / 300) * 5%' THEN
    RAISE EXCEPTION 'Could not safely update the punch-clock percentage formula';
  END IF;

  EXECUTE v_definition;
END;
$$;

UPDATE public.attendance AS a
SET deduction_amount = LEAST(
  CASE
    WHEN a.clock_in IS NOT NULL
      AND (a.clock_in AT TIME ZONE 'Africa/Lagos') > (a.work_date + time '07:45')
    THEN FLOOR(
      EXTRACT(EPOCH FROM ((a.clock_in AT TIME ZONE 'Africa/Lagos') - (a.work_date + time '07:45'))) / 300
    ) * 5
    ELSE 0
  END
  + CASE
    WHEN a.clock_out IS NOT NULL
      AND (a.clock_out AT TIME ZONE 'Africa/Lagos') < (
        a.work_date + CASE WHEN s.department = 'nursery' THEN time '12:40' ELSE time '13:10' END
      )
    THEN FLOOR(
      EXTRACT(EPOCH FROM (
        (a.work_date + CASE WHEN s.department = 'nursery' THEN time '12:40' ELSE time '13:10' END)
        - (a.clock_out AT TIME ZONE 'Africa/Lagos')
      )) / 300
    ) * 5
    ELSE 0
  END,
  100
)
FROM public.staff AS s
WHERE s.id = a.staff_id;