
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- Grant admin only to the designated email on signup / confirmation
CREATE OR REPLACE FUNCTION public.grant_admin_for_designated_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF lower(NEW.email) = 'mustydawuddaura@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_grant_admin
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.grant_admin_for_designated_email();

-- Staff
CREATE TYPE public.department AS ENUM ('nursery', 'primary');

CREATE TABLE public.staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  department public.department NOT NULL,
  pin text NOT NULL,
  base_salary numeric(12,2) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pin)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff TO authenticated;
GRANT ALL ON public.staff TO service_role;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin manage staff" ON public.staff FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Attendance
CREATE TABLE public.attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  clock_in timestamptz,
  clock_out timestamptz,
  late_minutes integer NOT NULL DEFAULT 0,
  deduction_amount numeric(12,2) NOT NULL DEFAULT 0,
  on_time boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, work_date)
);
GRANT SELECT ON public.attendance TO authenticated;
GRANT ALL ON public.attendance TO service_role;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read attendance" ON public.attendance FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Public RPC used by the clock-in kiosk (validates 4-digit PIN, no auth required)
CREATE OR REPLACE FUNCTION public.punch_clock(p_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff public.staff%ROWTYPE;
  v_now timestamptz := now();
  v_local timestamp := (v_now AT TIME ZONE 'Africa/Lagos');
  v_date date := v_local::date;
  v_threshold timestamp := v_date + time '07:30';
  v_late_min integer := 0;
  v_deduct numeric := 0;
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

  SELECT * INTO v_row FROM public.attendance WHERE staff_id = v_staff.id AND work_date = v_date;

  IF NOT FOUND THEN
    -- Clock in
    IF v_local > v_threshold THEN
      v_late_min := CEIL(EXTRACT(EPOCH FROM (v_local - v_threshold))/60)::int;
      v_deduct := CEIL(v_late_min::numeric / 15) * 100;
      v_ontime := false;
    END IF;
    INSERT INTO public.attendance (staff_id, work_date, clock_in, late_minutes, deduction_amount, on_time)
    VALUES (v_staff.id, v_date, v_now, v_late_min, v_deduct, v_ontime)
    RETURNING * INTO v_row;
    v_action := 'in';
  ELSIF v_row.clock_out IS NULL THEN
    UPDATE public.attendance SET clock_out = v_now WHERE id = v_row.id RETURNING * INTO v_row;
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
    'deduction_amount', v_row.deduction_amount,
    'on_time', v_row.on_time
  );
END;
$$;

REVOKE ALL ON FUNCTION public.punch_clock(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.punch_clock(text) TO anon, authenticated;
