import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, FileText, FileDown } from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { downloadCsv, buildPdf, savePdf } from "@/lib/exports";

// Return ISO Monday of the week containing d (yyyy-mm-dd)
function isoMondayOf(dateIso: string) {
  const d = new Date(dateIso + "T00:00:00");
  const dow = d.getDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
function addDaysIso(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export const Route = createFileRoute("/_authenticated/staff/$staffId")({
  component: StaffHistoryPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Staff not found.</div>,
});

type Staff = {
  id: string;
  full_name: string;
  department: "nursery" | "primary";
  pin: string;
  base_salary: number;
  active: boolean;
};

type Attendance = {
  id: string;
  work_date: string;
  clock_in: string | null;
  clock_out: string | null;
  late_minutes: number;
  deduction_amount: number;
  on_time: boolean;
};

const today = new Date();
const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1)
  .toISOString()
  .slice(0, 10);
const defaultTo = today.toISOString().slice(0, 10);

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-NG", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function monthBounds(dateIso: string) {
  const [year, month] = dateIso.split("-").map(Number);
  const next = new Date(year, month, 1);
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`,
  };
}

function workingDaysInMonth(dateIso: string, holidays: Set<string>) {
  const [year, month] = dateIso.split("-").map(Number);
  let count = 0;
  for (let day = 1; day <= new Date(year, month, 0).getDate(); day++) {
    const date = new Date(year, month - 1, day);
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (date.getDay() !== 0 && date.getDay() !== 6 && !holidays.has(iso)) count++;
  }
  return count || 22;
}

function StaffHistoryPage() {
  const { staffId } = useParams({ from: "/_authenticated/staff/$staffId" });
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [weekStart, setWeekStart] = useState<string>(isoMondayOf(defaultTo));
  const weekEnd = addDaysIso(weekStart, 4);
  const holidayStart = [monthBounds(from).start, monthBounds(weekStart).start].sort()[0];
  const holidayEnd = [monthBounds(to).end, monthBounds(weekEnd).end].sort().at(-1) ?? monthBounds(to).end;

  const { data: staff } = useQuery({
    queryKey: ["staff", staffId],
    queryFn: async () => {
      const { data, error } = await supabase.from("staff").select("*").eq("id", staffId).maybeSingle();
      if (error) throw error;
      return data as Staff | null;
    },
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["attendance", staffId, from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance")
        .select("*")
        .eq("staff_id", staffId)
        .gte("work_date", from)
        .lte("work_date", to)
        .order("work_date", { ascending: false });
      if (error) throw error;
      return data as Attendance[];
    },
  });

  const { data: weeklyAttendance = [] } = useQuery({
    queryKey: ["attendance-week", staffId, weekStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance")
        .select("*")
        .eq("staff_id", staffId)
        .gte("work_date", weekStart)
        .lte("work_date", weekEnd)
        .order("work_date", { ascending: true });
      if (error) throw error;
      return data as Attendance[];
    },
  });

  const { data: holidayRows = [] } = useQuery({
    queryKey: ["holidays", holidayStart, holidayEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("holidays")
        .select("work_date")
        .gte("work_date", holidayStart)
        .lt("work_date", holidayEnd);
      if (error) throw error;
      return data as { work_date: string }[];
    },
  });
  const holidaySet = new Set(holidayRows.map((h) => h.work_date));

  const MISSED_OUT_PCT = 20;
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  // Every deduction uses that date's monthly daily pay: salary / actual month working days.
  let workingDaysElapsed = 0;
  let absentNaira = 0;
  if (from && to) {
    const start = new Date(from + "T00:00:00");
    const end = new Date(to + "T00:00:00");
    for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
      const dow = dt.getDay();
      if (dow === 0 || dow === 6) continue;
      const iso = dt.toISOString().slice(0, 10);
      if (holidaySet.has(iso)) continue;
      if (iso <= todayIso) {
        workingDaysElapsed++;
        if (!rows.some((row) => row.work_date === iso && row.clock_in)) {
          absentNaira += Number(staff?.base_salary ?? 0) / workingDaysInMonth(iso, holidaySet);
        }
      }
    }
  }
  const selectedMonthWorkingDays = workingDaysInMonth(from, holidaySet);
  const selectedMonthDailyPay = Number(staff?.base_salary ?? 0) / selectedMonthWorkingDays;
  const dailyPayForDate = (dateIso: string) => Number(staff?.base_salary ?? 0) / workingDaysInMonth(dateIso, holidaySet);
  const rowDeductionNaira = (r: Attendance) => (dailyPayForDate(r.work_date) * Number(r.deduction_amount || 0)) / 100;
  const latePct = rows.reduce((sum, r) => sum + Number(r.deduction_amount || 0), 0);
  const missedOutDays = rows.filter((r) => r.clock_in && !r.clock_out && r.work_date < todayIso).length;
  const missedOutPct = missedOutDays * MISSED_OUT_PCT;
  const missedOutNaira = rows
    .filter((r) => r.clock_in && !r.clock_out && r.work_date < todayIso)
    .reduce((sum, r) => sum + (dailyPayForDate(r.work_date) * MISSED_OUT_PCT) / 100, 0);
  const presentDays = rows.filter((r) => r.clock_in).length;
  const absentDays = Math.max(0, workingDaysElapsed - presentDays);
  const absentPct = absentDays * 100;
  const totalDeductionPct = latePct + missedOutPct + absentPct;
  const lateNaira = rows.reduce((sum, r) => sum + rowDeductionNaira(r), 0);
  const totalDeduction = Math.min(Number(staff?.base_salary ?? 0), lateNaira + missedOutNaira + absentNaira);
  const lateDays = rows.filter((r) => !r.on_time).length;
  const netPay = Math.max(0, Number(staff?.base_salary ?? 0) - totalDeduction);

  const STAFF_PALETTE = [
    "#0EA5E9", "#8B5CF6", "#EC4899", "#F59E0B", "#10B981",
    "#EF4444", "#14B8A6", "#F97316", "#6366F1", "#84CC16",
    "#06B6D4", "#D946EF",
  ];
  const staffColor = STAFF_PALETTE[
    staffId.split("").reduce((a: number, c: string) => a + c.charCodeAt(0), 0) % STAFF_PALETTE.length
  ];

  // Weekly summary (Mon–Fri of selected week)
  const weekLabelEnd = addDaysIso(weekStart, 4);
  const weekRows: Array<{ date: string; label: string; clock_in: string | null; clock_out: string | null; status: string; late_min: number; deduction_pct: number; naira: number }> = [];
  let weekTotalPct = 0;
  let weekTotalNaira = 0;
  for (let i = 0; i < 5; i++) {
    const iso = addDaysIso(weekStart, i);
    const isHoliday = holidaySet.has(iso);
    const rec = weeklyAttendance.find((r) => r.work_date === iso);
    let pct = 0;
    let status = "—";
    if (isHoliday) {
      status = "Holiday";
    } else if (iso > todayIso) {
      status = "Upcoming";
    } else if (!rec || !rec.clock_in) {
      status = "Absent";
      pct = 100;
    } else if (!rec.clock_out) {
      status = "Missed clock-out";
      pct = Number(rec.deduction_amount || 0) + MISSED_OUT_PCT;
    } else if (rec.on_time) {
      status = "On time";
      pct = Number(rec.deduction_amount || 0);
    } else {
      status = "Late";
      pct = Number(rec.deduction_amount || 0);
    }
    const naira = (dailyPayForDate(iso) * pct) / 100;
    weekTotalPct += pct;
    weekTotalNaira += naira;
    weekRows.push({
      date: iso,
      label: new Date(iso + "T00:00:00").toLocaleDateString("en-NG", { weekday: "short", day: "2-digit", month: "short" }),
      clock_in: rec?.clock_in ?? null,
      clock_out: rec?.clock_out ?? null,
      status,
      late_min: rec?.late_minutes ?? 0,
      deduction_pct: pct,
      naira,
    });
  }
  const weekLabel = `Week of ${new Date(weekStart + "T00:00:00").toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })} to ${new Date(weekLabelEnd + "T00:00:00").toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })}`;

  function weeklyHeaders() {
    return ["Date", "Clock in", "Clock out", "Status", "Late min", "Deduction %", "Deduction ₦"];
  }
  function weeklyBody() {
    return weekRows.map((r) => [
      r.label,
      r.clock_in ? new Date(r.clock_in).toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }) : "—",
      r.clock_out ? new Date(r.clock_out).toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }) : "—",
      r.status,
      r.late_min,
      `${r.deduction_pct}%`,
      Math.round(r.naira).toLocaleString(),
    ]);
  }
  function downloadWeeklyCsv() {
    downloadCsv(`${staff?.full_name ?? "staff"}-week-${weekStart}.csv`, weeklyHeaders(), weeklyBody());
  }
  function downloadWeeklyPdf() {
    const doc = buildPdf({
      title: `Weekly Deduction Statement — ${staff?.full_name ?? ""}`,
      subtitle: weekLabel,
      meta: [
        { label: "Department", value: String(staff?.department ?? "") },
        { label: "PIN", value: String(staff?.pin ?? "") },
        { label: "Base salary", value: `₦${Number(staff?.base_salary ?? 0).toLocaleString()}` },
        { label: "Daily pay", value: `₦${Math.round(dailyPayForDate(weekStart)).toLocaleString()} (${workingDaysInMonth(weekStart, holidaySet)} working days in month)` },
        { label: "Total deduction %", value: `${weekTotalPct}%` },
        { label: "Total deduction ₦", value: `₦${Math.round(weekTotalNaira).toLocaleString()}` },
      ],
      tables: [{ headers: weeklyHeaders(), rows: weeklyBody() }],
      footer: `Staff acknowledgement: __________________________   Admin: __________________________   Generated ${new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}`,
    });
    savePdf(doc, `${(staff?.full_name ?? "staff").replace(/\s+/g, "_")}-week-${weekStart}.pdf`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link to="/staff">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to staff
            </Link>
          </Button>
          <h2 className="flex items-center gap-3 text-2xl font-bold">
            <span className="inline-block h-4 w-4 rounded-full ring-2 ring-offset-2 ring-offset-background" style={{ backgroundColor: staffColor, boxShadow: `0 0 0 2px ${staffColor}33` }} />
            {staff?.full_name ?? "Staff"}
          </h2>
          <p className="text-sm text-muted-foreground capitalize">
            {staff?.department} · PIN {staff?.pin} · Base salary ₦
            {Number(staff?.base_salary ?? 0).toLocaleString()}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Days present</p>
          <p className="mt-1 text-2xl font-bold">{presentDays}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Late days</p>
          <p className="mt-1 text-2xl font-bold text-destructive">{lateDays}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Total deductions</p>
          <p className="mt-1 text-2xl font-bold text-destructive">
            {totalDeductionPct}%
          </p>
          <p className="text-xs text-muted-foreground">≈ ₦{Math.round(totalDeduction).toLocaleString()}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Net pay (range)</p>
          <p className="mt-1 text-2xl font-bold text-success">
            ₦{Math.round(netPay).toLocaleString()}
          </p>
        </Card>
      </div>

      <Card className="p-5">
        <p className="mb-3 text-sm font-semibold">Deduction breakdown</p>
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-lg border p-4">
            <p className="text-xs uppercase text-muted-foreground">Late / early-out</p>
            <p className="mt-1 text-xl font-bold text-destructive">{latePct}%</p>
            <p className="text-xs text-muted-foreground">− ₦{Math.round(lateNaira).toLocaleString()} · 20% per 5 min</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs uppercase text-muted-foreground">Missed clock-out</p>
            <p className="mt-1 text-xl font-bold text-destructive">{missedOutPct}%</p>
            <p className="text-xs text-muted-foreground">− ₦{Math.round(missedOutNaira).toLocaleString()} ({missedOutDays} day{missedOutDays === 1 ? "" : "s"} · 20% each)</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs uppercase text-muted-foreground">Absent ({absentDays} day{absentDays === 1 ? "" : "s"})</p>
            <p className="mt-1 text-xl font-bold text-destructive">{absentPct}%</p>
            <p className="text-xs text-muted-foreground">− ₦{Math.round(absentNaira).toLocaleString()} · 100% of each absent day</p>
          </div>
          <div className="rounded-lg border p-4 bg-muted/30">
            <p className="text-xs uppercase text-muted-foreground">Total (range)</p>
            <p className="mt-1 text-xl font-bold text-destructive">{totalDeductionPct}%</p>
            <p className="text-xs text-muted-foreground">− ₦{Math.round(totalDeduction).toLocaleString()} · Daily pay ₦{Math.round(selectedMonthDailyPay).toLocaleString()} ({selectedMonthWorkingDays} working days)</p>
          </div>
        </div>
      </Card>


      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">On-time vs Late</p>
          {presentDays === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={[
                    { name: "On time", value: presentDays - lateDays },
                    { name: "Late", value: lateDays },
                  ]}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                  label
                >
                  <Cell fill={staffColor} />
                  <Cell fill="hsl(var(--destructive))" />
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">Daily deduction (% of daily pay)</p>
          {rows.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={[...rows].reverse().map((r) => ({
                date: r.work_date.slice(5),
                percent: Number(r.deduction_amount || 0),
              }))}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} unit="%" />
                <Tooltip formatter={(v: number) => `${v}%`} />
                <Bar dataKey="percent" fill={staffColor} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Weekly deduction statement</p>
            <p className="text-xs text-muted-foreground">Download a per-week summary as proof of deduction for this staff member.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="week">Week starting (Monday)</Label>
              <Input id="week" type="date" value={weekStart}
                onChange={(e) => setWeekStart(isoMondayOf(e.target.value || defaultTo))} />
            </div>
            <Button variant="outline" onClick={downloadWeeklyCsv}>
              <FileDown className="mr-2 h-4 w-4" /> CSV
            </Button>
            <Button onClick={downloadWeeklyPdf}>
              <FileText className="mr-2 h-4 w-4" /> Download PDF
            </Button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Day</th>
                <th className="px-3 py-2">Clock in</th>
                <th className="px-3 py-2">Clock out</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Late min</th>
                <th className="px-3 py-2 text-right">Deduction %</th>
                <th className="px-3 py-2 text-right">Deduction ₦</th>
              </tr>
            </thead>
            <tbody>
              {weekRows.map((r) => (
                <tr key={r.date} className="border-t">
                  <td className="px-3 py-2 font-medium">{r.label}</td>
                  <td className="px-3 py-2 font-mono">{fmtTime(r.clock_in)}</td>
                  <td className="px-3 py-2 font-mono">{fmtTime(r.clock_out)}</td>
                  <td className="px-3 py-2">{r.status}</td>
                  <td className="px-3 py-2 text-right">{r.late_min || 0}</td>
                  <td className={"px-3 py-2 text-right " + (r.deduction_pct > 0 ? "text-destructive font-semibold" : "text-muted-foreground")}>
                    {r.deduction_pct}%
                  </td>
                  <td className={"px-3 py-2 text-right " + (r.naira > 0 ? "text-destructive" : "text-muted-foreground")}>
                    ₦{Math.round(r.naira).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/30 text-sm font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={5}>Week total</td>
                <td className="px-3 py-2 text-right text-destructive">{weekTotalPct}%</td>
                <td className="px-3 py-2 text-right text-destructive">₦{Math.round(weekTotalNaira).toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <Label htmlFor="from">From</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="to">To</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Clock in</th>
                <th className="px-4 py-3">Clock out</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Late (min)</th>
                <th className="px-4 py-3 text-right">Deduction</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    No attendance records in this range.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-3 font-medium">{fmtDate(r.work_date)}</td>
                  <td
                    className={
                      "px-4 py-3 font-mono " +
                      (r.on_time ? "text-success" : "text-destructive")
                    }
                  >
                    {fmtTime(r.clock_in)}
                  </td>
                  <td className="px-4 py-3 font-mono">{fmtTime(r.clock_out)}</td>
                  <td className="px-4 py-3">
                    {r.on_time ? (
                      <Badge className="bg-success text-success-foreground hover:bg-success">
                        On time
                      </Badge>
                    ) : (
                      <Badge variant="destructive">Late</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">{r.late_minutes || 0}</td>
                  <td
                    className={
                      "px-4 py-3 text-right font-medium " +
                      (Number(r.deduction_amount) > 0 ? "text-destructive" : "")
                    }
                  >
                    {Number(r.deduction_amount || 0)}%
                    {Number(r.deduction_amount) > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (≈ ₦{Math.round(rowDeductionNaira(r)).toLocaleString()})
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t bg-muted/30 text-sm font-semibold">
                <tr>
                  <td className="px-4 py-3" colSpan={4}>
                    Totals
                  </td>
                  <td className="px-4 py-3 text-right">
                    {rows.reduce((s, r) => s + (r.late_minutes || 0), 0)}
                  </td>
                  <td className="px-4 py-3 text-right text-destructive">
                    {totalDeductionPct}%
                    <span className="ml-2 text-xs text-muted-foreground">(≈ ₦{Math.round(totalDeduction).toLocaleString()})</span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}
