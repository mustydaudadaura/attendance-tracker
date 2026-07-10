import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/payroll")({ component: Payroll });

function currentMonthLagos() {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit" });
  return fmt.format(new Date()); // yyyy-mm
}

function Payroll() {
  const [month, setMonth] = useState(currentMonthLagos());
  const [year, m] = month.split("-").map(Number);
  const start = `${year}-${String(m).padStart(2, "0")}-01`;
  const endDate = new Date(year, m, 1); // first of next month
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-01`;

  const { data } = useQuery({
    queryKey: ["payroll", month],
    queryFn: async () => {
      const [staff, att, hol] = await Promise.all([
        supabase.from("staff").select("id, full_name, department, base_salary, active"),
        supabase.from("attendance").select("staff_id, work_date, clock_in, clock_out, late_minutes, deduction_amount, on_time")
          .gte("work_date", start).lt("work_date", end),
        supabase.from("holidays").select("work_date").gte("work_date", start).lt("work_date", end),
      ]);
      if (staff.error) throw staff.error;
      if (att.error) throw att.error;
      if (hol.error) throw hol.error;
      return { staff: staff.data, att: att.data, holidays: new Set((hol.data ?? []).map((h) => h.work_date as string)) };
    },
  });

  // Count Mon-Fri working days in the selected month up to today (Lagos)
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const holidaySet = data?.holidays ?? new Set<string>();
  let workingDaysElapsed = 0;
  let totalWorkingDays = 0;
  for (let d = 1; d <= new Date(year, m, 0).getDate(); d++) {
    const dt = new Date(year, m - 1, d);
    const dow = dt.getDay(); // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) continue;
    const iso = `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (holidaySet.has(iso)) continue;
    totalWorkingDays++;
    if (iso <= todayStr) workingDaysElapsed++;
  }
  const WORKING_DAYS = totalWorkingDays || 22;

  const MISSED_OUT_PCT = 20; // penalty per day with clock-in but no clock-out (past days)
  const rows = (data?.staff ?? []).map((s) => {
    const mine = (data?.att ?? []).filter((a) => a.staff_id === s.id);
    const daysPresent = mine.length;
    const lateDays = mine.filter((a) => !a.on_time).length;
    const totalLateMinutes = mine.reduce((n, a) => n + (a.late_minutes ?? 0), 0);
    const latePct = mine.reduce((n, a) => n + Number(a.deduction_amount ?? 0), 0);
    const missedOutDays = mine.filter((a) => a.clock_in && !a.clock_out && a.work_date < todayStr).length;
    const missedOutPct = missedOutDays * MISSED_OUT_PCT;
    const absentDays = Math.max(0, workingDaysElapsed - daysPresent);
    const absentPct = absentDays * 100;
    const totalPct = latePct + absentPct + missedOutPct;
    const dailyPay = Number(s.base_salary) / WORKING_DAYS;
    const totalDeduction = Math.min(Number(s.base_salary), (dailyPay * totalPct) / 100);
    const netPay = Math.max(0, Number(s.base_salary) - totalDeduction);
    return { ...s, daysPresent, absentDays, lateDays, totalLateMinutes, latePct, absentPct, missedOutDays, missedOutPct, totalPct, totalDeduction, netPay };
  });

  const totals = rows.reduce((acc, r) => ({
    salary: acc.salary + Number(r.base_salary),
    deduction: acc.deduction + r.totalDeduction,
    net: acc.net + r.netPay,
  }), { salary: 0, deduction: 0, net: 0 });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Payroll</h2>
          <p className="text-sm text-muted-foreground">Work week: Monday–Friday, holidays excluded ({WORKING_DAYS} working days this month). Late (after 7:45am) or early sign-out = 5% of daily pay per 5 minutes. Missed sign-out = 20% penalty. Absent weekday (no sign-in) = 100%.</p>
        </div>
        <div>
          <Label htmlFor="month">Month</Label>
          <Input id="month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-48" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5"><div className="text-xs uppercase text-muted-foreground">Total salaries</div><div className="mt-2 text-2xl font-bold">₦{Math.round(totals.salary).toLocaleString()}</div></Card>
        <Card className="p-5"><div className="text-xs uppercase text-muted-foreground">Total deductions</div><div className="mt-2 text-2xl font-bold text-destructive">₦{Math.round(totals.deduction).toLocaleString()}</div></Card>
        <Card className="p-5"><div className="text-xs uppercase text-muted-foreground">Total net pay</div><div className="mt-2 text-2xl font-bold text-success">₦{Math.round(totals.net).toLocaleString()}</div></Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Staff</th>
                <th className="px-4 py-3">Dept</th>
                <th className="px-4 py-3 text-right">Present</th>
                <th className="px-4 py-3 text-right">Absent</th>
                <th className="px-4 py-3 text-right">Late days</th>
                <th className="px-4 py-3 text-right">Late min</th>
                <th className="px-4 py-3 text-right">Missed out</th>
                <th className="px-4 py-3 text-right">Base salary</th>
                <th className="px-4 py-3 text-right">Late %</th>
                <th className="px-4 py-3 text-right">Absent %</th>
                <th className="px-4 py-3 text-right">Missed %</th>
                <th className="px-4 py-3 text-right">Total %</th>
                <th className="px-4 py-3 text-right">Deduction ₦</th>
                <th className="px-4 py-3 text-right">Net pay</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={13} className="px-4 py-12 text-center text-muted-foreground">No staff registered yet.</td></tr>
              )}
              {rows.map((r) => {
                const dailyPay = Number(r.base_salary) / WORKING_DAYS;
                const lateNaira = (dailyPay * r.latePct) / 100;
                const absentNaira = (dailyPay * r.absentPct) / 100;
                const missedNaira = (dailyPay * r.missedOutPct) / 100;
                return (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-3 font-medium">{r.full_name}</td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{r.department}</td>
                  <td className="px-4 py-3 text-right">{r.daysPresent}</td>
                  <td className="px-4 py-3 text-right text-destructive">{r.absentDays}</td>
                  <td className="px-4 py-3 text-right">{r.lateDays}</td>
                  <td className="px-4 py-3 text-right">{r.totalLateMinutes}</td>
                  <td className="px-4 py-3 text-right text-destructive">{r.missedOutDays}</td>
                  <td className="px-4 py-3 text-right">₦{Number(r.base_salary).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    {r.latePct > 0 ? (
                      <><span className="text-destructive">{r.latePct}%</span><div className="text-xs text-muted-foreground">− ₦{Math.round(lateNaira).toLocaleString()}</div></>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.absentPct > 0 ? (
                      <><span className="text-destructive">{r.absentPct}%</span><div className="text-xs text-muted-foreground">− ₦{Math.round(absentNaira).toLocaleString()}</div></>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.missedOutPct > 0 ? (
                      <><span className="text-destructive">{r.missedOutPct}%</span><div className="text-xs text-muted-foreground">− ₦{Math.round(missedNaira).toLocaleString()}</div></>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-destructive">
                    {r.totalPct > 0 ? `${r.totalPct}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-destructive">
                    {r.totalDeduction > 0 ? `− ₦${Math.round(r.totalDeduction).toLocaleString()}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-success">₦{Math.round(r.netPay).toLocaleString()}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
