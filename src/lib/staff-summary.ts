import { supabase } from "@/integrations/supabase/client";
import { buildPdf, savePdf } from "@/lib/exports";

type Staff = {
  id: string;
  full_name: string;
  department: string;
  pin: string;
  base_salary: number;
};

type AttRow = {
  work_date: string;
  clock_in: string | null;
  clock_out: string | null;
  late_minutes: number | null;
  deduction_amount: number | null;
  on_time: boolean | null;
};

const MISSED_OUT_PCT = 20;

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayLagosIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function monthWorkingDays(year: number, month1: number, holidays: Set<string>) {
  let n = 0;
  const last = new Date(year, month1, 0).getDate();
  for (let d = 1; d <= last; d++) {
    const dt = new Date(year, month1 - 1, d);
    const dow = dt.getDay();
    if (dow === 0 || dow === 6) continue;
    const iso = `${year}-${String(month1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (holidays.has(iso)) continue;
    n++;
  }
  return n;
}

/** Enumerate Mon–Fri dates between start and end (inclusive), skipping holidays. */
function workingDatesInRange(startIso: string, endIso: string, holidays: Set<string>) {
  const out: string[] = [];
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  const start = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
    const dow = dt.getDay();
    if (dow === 0 || dow === 6) continue;
    const iso = isoDate(dt);
    if (holidays.has(iso)) continue;
    out.push(iso);
  }
  return out;
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-NG", {
    timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

async function fetchPeriod(staffId: string, startIso: string, endIsoExclusive: string) {
  const [att, hol] = await Promise.all([
    supabase.from("attendance")
      .select("work_date, clock_in, clock_out, late_minutes, deduction_amount, on_time")
      .eq("staff_id", staffId)
      .gte("work_date", startIso).lt("work_date", endIsoExclusive),
    supabase.from("holidays").select("work_date, label")
      .gte("work_date", startIso).lt("work_date", endIsoExclusive),
  ]);
  if (att.error) throw att.error;
  if (hol.error) throw hol.error;
  return {
    att: (att.data ?? []) as AttRow[],
    holidays: new Set<string>((hol.data ?? []).map((h) => h.work_date as string)),
    holidayLabels: new Map<string, string>((hol.data ?? []).map((h) => [h.work_date as string, h.label as string])),
  };
}

function buildDailyRows(dates: string[], att: AttRow[], holidayLabels: Map<string, string>, todayIso: string, dailyPay: number) {
  const byDate = new Map(att.map((a) => [a.work_date, a]));
  // union of working dates and any attendance dates within period (in case a holiday row exists)
  const allDates = Array.from(new Set([...dates, ...att.map((a) => a.work_date)])).sort();
  return allDates.map((iso) => {
    const a = byDate.get(iso);
    const holiday = holidayLabels.get(iso);
    const dow = new Date(iso + "T00:00:00").getDay();
    const isWeekend = dow === 0 || dow === 6;
    let status = "—";
    let pct = 0;
    if (holiday) status = `Holiday (${holiday})`;
    else if (isWeekend) status = "Weekend";
    else if (a) {
      if (a.clock_in && a.clock_out) status = a.on_time ? "On-time" : "Late";
      else if (a.clock_in && !a.clock_out) status = iso < todayIso ? "Missed sign-out" : "Signed in";
      pct = Number(a.deduction_amount ?? 0);
      if (a.clock_in && !a.clock_out && iso < todayIso) pct += MISSED_OUT_PCT;
    } else {
      status = iso < todayIso ? "Absent" : "—";
      if (iso < todayIso && !holiday && !isWeekend) pct = 100;
    }
    if (pct > 100) pct = 100;
    const naira = (dailyPay * pct) / 100;
    return {
      iso,
      clockIn: fmtTime(a?.clock_in ?? null),
      clockOut: fmtTime(a?.clock_out ?? null),
      status,
      lateMin: a?.late_minutes ?? 0,
      pct,
      naira,
    };
  });
}

function totalsFromDays(days: ReturnType<typeof buildDailyRows>, baseGross: number) {
  const pctSum = days.reduce((n, d) => n + d.pct, 0);
  const nairaSum = Math.min(baseGross, days.reduce((n, d) => n + d.naira, 0));
  return { pctSum, nairaSum, net: Math.max(0, baseGross - nairaSum) };
}

export async function downloadWeekSummary(staff: Staff, weekStartIso: string) {
  const [sy, sm, sd] = weekStartIso.split("-").map(Number);
  const start = new Date(sy, sm - 1, sd);
  const end = new Date(start); end.setDate(start.getDate() + 4); // Friday
  const endExcl = new Date(start); endExcl.setDate(start.getDate() + 5); // Saturday
  const startIso = isoDate(start);
  const endIso = isoDate(end);

  // Working-days basis uses the month that contains the week start
  const { att, holidays, holidayLabels } = await fetchPeriod(staff.id, startIso, isoDate(endExcl));
  const monthHol = await supabase.from("holidays").select("work_date")
    .gte("work_date", `${sy}-${String(sm).padStart(2, "0")}-01`)
    .lt("work_date", `${sm === 12 ? sy + 1 : sy}-${String(sm === 12 ? 1 : sm + 1).padStart(2, "0")}-01`);
  const monthHolidays = new Set<string>((monthHol.data ?? []).map((h) => h.work_date as string));
  const monthWD = monthWorkingDays(sy, sm, monthHolidays) || 22;
  const dailyPay = Number(staff.base_salary) / monthWD;

  const weekDates = workingDatesInRange(startIso, endIso, holidays);
  const days = buildDailyRows(weekDates, att, holidayLabels, todayLagosIso(), dailyPay);
  const weeklyGross = dailyPay * weekDates.length;
  const totals = totalsFromDays(days, weeklyGross);

  const monthLabel = new Date(sy, sm - 1, 1).toLocaleDateString("en-NG", { month: "long", year: "numeric" });
  const doc = buildPdf({
    title: `Weekly Deduction Statement — ${staff.full_name}`,
    subtitle: `${startIso} → ${endIso} (${monthLabel})`,
    meta: [
      { label: "Staff", value: staff.full_name },
      { label: "PIN", value: staff.pin },
      { label: "Department", value: staff.department },
      { label: "Base salary (month)", value: `₦${Math.round(Number(staff.base_salary)).toLocaleString()}` },
      { label: "Daily pay", value: `₦${Math.round(dailyPay).toLocaleString()} (of ${monthWD} working days)` },
      { label: "Week working days", value: String(weekDates.length) },
      { label: "Total deduction %", value: `${Math.round(totals.pctSum)}%` },
      { label: "Total deduction ₦", value: `₦${Math.round(totals.nairaSum).toLocaleString()}` },
    ],
    tables: [{
      headers: ["Date", "Clock in", "Clock out", "Status", "Late min", "Deduction %", "Deduction ₦"],
      rows: days.map((d) => [
        d.iso, d.clockIn, d.clockOut, d.status, d.lateMin,
        d.pct > 0 ? `${d.pct}%` : "—",
        d.naira > 0 ? Math.round(d.naira).toLocaleString() : "—",
      ]),
    }],
    footer: "Confidential payroll record — Assalam Tahfizul Qur'an Academy Ltd",
  });
  savePdf(doc, `${staff.full_name.replace(/\s+/g, "_")}_week_${startIso}.pdf`);
}

export async function downloadMonthSummary(staff: Staff, monthIso: string /* yyyy-mm */) {
  const [y, m] = monthIso.split("-").map(Number);
  const startIso = `${y}-${String(m).padStart(2, "0")}-01`;
  const endMonth = new Date(y, m, 1);
  const endExcl = `${endMonth.getFullYear()}-${String(endMonth.getMonth() + 1).padStart(2, "0")}-01`;
  const endIso = isoDate(new Date(y, m, 0));

  const { att, holidays, holidayLabels } = await fetchPeriod(staff.id, startIso, endExcl);
  const monthWD = monthWorkingDays(y, m, holidays) || 22;
  const dailyPay = Number(staff.base_salary) / monthWD;

  const dates = workingDatesInRange(startIso, endIso, holidays);
  const days = buildDailyRows(dates, att, holidayLabels, todayLagosIso(), dailyPay);
  const baseGross = Number(staff.base_salary);
  const totals = totalsFromDays(days, baseGross);

  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString("en-NG", { month: "long", year: "numeric" });
  const doc = buildPdf({
    title: `Monthly Deduction Statement — ${staff.full_name}`,
    subtitle: monthLabel,
    meta: [
      { label: "Staff", value: staff.full_name },
      { label: "PIN", value: staff.pin },
      { label: "Department", value: staff.department },
      { label: "Base salary", value: `₦${Math.round(baseGross).toLocaleString()}` },
      { label: "Working days", value: String(monthWD) },
      { label: "Daily pay", value: `₦${Math.round(dailyPay).toLocaleString()}` },
      { label: "Total deduction %", value: `${Math.round(totals.pctSum)}%` },
      { label: "Total deduction ₦", value: `₦${Math.round(totals.nairaSum).toLocaleString()}` },
      { label: "Net pay", value: `₦${Math.round(totals.net).toLocaleString()}` },
      { label: "Generated", value: new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" }) },
    ],
    tables: [{
      headers: ["Date", "Clock in", "Clock out", "Status", "Late min", "Deduction %", "Deduction ₦"],
      rows: days.map((d) => [
        d.iso, d.clockIn, d.clockOut, d.status, d.lateMin,
        d.pct > 0 ? `${d.pct}%` : "—",
        d.naira > 0 ? Math.round(d.naira).toLocaleString() : "—",
      ]),
    }],
    footer: "Confidential payroll record — Assalam Tahfizul Qur'an Academy Ltd",
  });
  savePdf(doc, `${staff.full_name.replace(/\s+/g, "_")}_${monthIso}.pdf`);
}

/** Monday of the ISO week containing d (Lagos). */
export function isoMondayOf(d = new Date()) {
  const lagos = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(d));
  const dow = lagos.getDay(); // 0..6 (Sun..Sat)
  const diff = (dow + 6) % 7; // days since Monday
  lagos.setDate(lagos.getDate() - diff);
  return isoDate(lagos);
}

export function currentMonthIsoLagos() {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit" });
  return fmt.format(new Date());
}
