import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Clock, AlertTriangle, Wallet } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: Dashboard });

function todayLagos() {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(new Date());
}

function Dashboard() {
  const today = todayLagos();
  const { data } = useQuery({
    queryKey: ["dashboard", today],
    queryFn: async () => {
      const [staff, att] = await Promise.all([
        supabase.from("staff").select("id, full_name, department, active").eq("active", true),
        supabase.from("attendance").select("*, staff:staff(full_name, department)").eq("work_date", today).order("clock_in", { ascending: false }),
      ]);
      if (staff.error) throw staff.error;
      if (att.error) throw att.error;
      return { staff: staff.data, att: att.data };
    },
  });

  const staffCount = data?.staff.length ?? 0;
  const rows = data?.att ?? [];
  const present = rows.length;
  const late = rows.filter((r) => !r.on_time).length;
  const totalDeduction = rows.reduce((s, r) => s + Number(r.deduction_amount ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Today · {today}</h2>
        <p className="text-sm text-muted-foreground">Live attendance overview for today.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard icon={Users} label="Active staff" value={staffCount} />
        <StatCard icon={Clock} label="Clocked in today" value={present} />
        <StatCard icon={AlertTriangle} label="Late today" value={late} tone={late > 0 ? "warn" : "ok"} />
        <StatCard icon={Wallet} label="Deductions today" value={`₦${totalDeduction.toLocaleString()}`} tone={totalDeduction > 0 ? "warn" : "ok"} />
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b p-4"><h3 className="font-semibold">Today's punches</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Staff</th>
                <th className="px-4 py-3">Dept</th>
                <th className="px-4 py-3">Clock In</th>
                <th className="px-4 py-3">Clock Out</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Deduction</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No punches yet today.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-3 font-medium">{r.staff?.full_name}</td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{r.staff?.department}</td>
                  <td className={r.on_time ? "px-4 py-3 font-semibold text-success" : "px-4 py-3 font-semibold text-destructive"}>
                    {r.clock_in ? new Date(r.clock_in).toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {r.clock_out ? new Date(r.clock_out).toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {r.on_time
                      ? <Badge className="bg-success text-success-foreground hover:bg-success">On time</Badge>
                      : <Badge variant="destructive">Late {r.late_minutes}m</Badge>}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {Number(r.deduction_amount) > 0
                      ? <span className="text-destructive">₦{Number(r.deduction_amount).toLocaleString()}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; tone?: "ok" | "warn" }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className={tone === "warn" ? "h-4 w-4 text-destructive" : "h-4 w-4 text-primary"} />
      </div>
      <div className={tone === "warn" ? "mt-2 text-3xl font-bold text-destructive" : "mt-2 text-3xl font-bold"}>{value}</div>
    </Card>
  );
}
