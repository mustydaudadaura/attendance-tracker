import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, CalendarPlus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/holidays")({ component: Holidays });

type Holiday = { work_date: string; label: string };

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-NG", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });
}

function todayIsoLagos() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function Holidays() {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayIsoLagos());
  const [label, setLabel] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["holidays"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("holidays")
        .select("work_date, label")
        .order("work_date", { ascending: false });
      if (error) throw error;
      return data as Holiday[];
    },
  });

  const addMut = useMutation({
    mutationFn: async () => {
      if (!date) throw new Error("Pick a date");
      const { error } = await supabase.from("holidays").upsert({
        work_date: date,
        label: label.trim() || "Holiday",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Holiday saved");
      setLabel("");
      qc.invalidateQueries({ queryKey: ["holidays"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: async (work_date: string) => {
      const { error } = await supabase.from("holidays").delete().eq("work_date", work_date);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Holiday removed");
      qc.invalidateQueries({ queryKey: ["holidays"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const today = todayIsoLagos();
  const upcoming = rows.filter((r) => r.work_date >= today);
  const past = rows.filter((r) => r.work_date < today);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Holidays</h2>
        <p className="text-sm text-muted-foreground">
          Mark dates as company holidays. Staff cannot sign in on holidays and payroll skips these days when computing working days and absence.
        </p>
      </div>

      <Card className="p-5">
        <p className="mb-3 text-sm font-semibold">Add a holiday</p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => { e.preventDefault(); addMut.mutate(); }}
        >
          <div>
            <Label htmlFor="date">Date</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="min-w-[220px] flex-1">
            <Label htmlFor="label">Label (optional)</Label>
            <Input id="label" placeholder="e.g. Eid al-Fitr" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <Button type="submit" disabled={addMut.isPending}>
            <CalendarPlus className="mr-2 h-4 w-4" /> {addMut.isPending ? "Saving…" : "Save holiday"}
          </Button>
        </form>
      </Card>

      <HolidayList title="Upcoming & today" rows={upcoming} loading={isLoading} onDelete={(d) => delMut.mutate(d)} empty="No upcoming holidays." />
      <HolidayList title="Past" rows={past} loading={isLoading} onDelete={(d) => delMut.mutate(d)} empty="No past holidays." />
    </div>
  );
}

function HolidayList({
  title, rows, loading, empty, onDelete,
}: { title: string; rows: Holiday[]; loading: boolean; empty: string; onDelete: (d: string) => void }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b bg-muted/40 px-4 py-3 text-sm font-semibold">{title}</div>
      <table className="w-full text-sm">
        <thead className="bg-muted/20 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-4 py-2">Date</th>
            <th className="px-4 py-2">Label</th>
            <th className="px-4 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
          )}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">{empty}</td></tr>
          )}
          {rows.map((r) => (
            <tr key={r.work_date} className="border-t">
              <td className="px-4 py-3 font-medium">{fmtDate(r.work_date)}</td>
              <td className="px-4 py-3">{r.label}</td>
              <td className="px-4 py-3 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { if (confirm(`Remove holiday on ${fmtDate(r.work_date)}?`)) onDelete(r.work_date); }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
