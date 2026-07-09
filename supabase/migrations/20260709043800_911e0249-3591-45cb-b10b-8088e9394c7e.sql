
CREATE OR REPLACE FUNCTION public.daily_penalty_summary(p_date date)
RETURNS TABLE (
  staff_id uuid,
  full_name text,
  department text,
  clock_in timestamptz,
  clock_out timestamptz,
  late_minutes integer,
  deduction_percent numeric,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH today_local AS (
    SELECT ((now() AT TIME ZONE 'Africa/Lagos')::date) AS d
  )
  SELECT
    s.id AS staff_id,
    s.full_name,
    s.department::text,
    a.clock_in,
    a.clock_out,
    COALESCE(a.late_minutes, 0) AS late_minutes,
    COALESCE(a.deduction_amount, 0)
      + CASE
          WHEN a.clock_in IS NOT NULL
           AND a.clock_out IS NULL
           AND p_date < (SELECT d FROM today_local)
          THEN 20
          ELSE 0
        END AS deduction_percent,
    CASE
      WHEN a.id IS NULL AND p_date < (SELECT d FROM today_local) THEN 'absent'
      WHEN a.id IS NULL THEN 'not-yet'
      WHEN a.clock_in IS NOT NULL AND a.clock_out IS NULL
           AND p_date < (SELECT d FROM today_local) THEN 'missed-out'
      WHEN a.clock_in IS NOT NULL AND a.clock_out IS NULL THEN 'in'
      WHEN a.on_time THEN 'on-time'
      ELSE 'late'
    END AS status
  FROM public.staff s
  LEFT JOIN public.attendance a
    ON a.staff_id = s.id AND a.work_date = p_date
  WHERE s.active = true
  ORDER BY s.full_name;
$$;

REVOKE ALL ON FUNCTION public.daily_penalty_summary(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daily_penalty_summary(date) TO anon, authenticated;
