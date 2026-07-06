import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft } from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

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

function StaffHistoryPage() {
  const { staffId } = useParams({ from: "/_authenticated/staff/$staffId" });
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

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

  const totalDeduction = rows.reduce((sum, r) => sum + Number(r.deduction_amount || 0), 0);
  const lateDays = rows.filter((r) => !r.on_time).length;
  const presentDays = rows.filter((r) => r.clock_in).length;
  const netPay = Math.max(0, Number(staff?.base_salary ?? 0) - totalDeduction);

  const STAFF_PALETTE = [
    "#0EA5E9", "#8B5CF6", "#EC4899", "#F59E0B", "#10B981",
    "#EF4444", "#14B8A6", "#F97316", "#6366F1", "#84CC16",
    "#06B6D4", "#D946EF",
  ];
  const staffColor = STAFF_PALETTE[
    staffId.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % STAFF_PALETTE.length
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link to="/staff">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to staff
            </Link>
          </Button>
          <h2 className="text-2xl font-bold">{staff?.full_name ?? "Staff"}</h2>
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
            ₦{totalDeduction.toLocaleString()}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Net pay (range)</p>
          <p className="mt-1 text-2xl font-bold text-success">
            ₦{netPay.toLocaleString()}
          </p>
        </Card>
      </div>

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
                  <Cell fill="hsl(var(--success))" />
                  <Cell fill="hsl(var(--destructive))" />
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">Daily deductions (₦)</p>
          {rows.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={[...rows].reverse().map((r) => ({
                date: r.work_date.slice(5),
                deduction: Number(r.deduction_amount || 0),
              }))}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(v: number) => `₦${v.toLocaleString()}`} />
                <Bar dataKey="deduction" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

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
                    ₦{Number(r.deduction_amount || 0).toLocaleString()}
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
                    ₦{totalDeduction.toLocaleString()}
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
