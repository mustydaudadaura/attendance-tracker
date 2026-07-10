import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { MapPin, ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/geofence-audit")({
  component: GeofenceAudit,
});

type Row = {
  id: string;
  attempted_at: string;
  staff_name: string | null;
  department: string | null;
  lat: number | null;
  lng: number | null;
  distance_m: number | null;
  radius_m: number | null;
  on_site: boolean | null;
  allowed: boolean;
  action: string | null;
  error_message: string | null;
};

function GeofenceAudit() {
  const [filter, setFilter] = useState<"off" | "all">("off");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["geofence_attempts", filter],
    queryFn: async () => {
      let q = supabase
        .from("geofence_attempts")
        .select("id, attempted_at, staff_name, department, lat, lng, distance_m, radius_m, on_site, allowed, action, error_message")
        .order("attempted_at", { ascending: false })
        .limit(500);
      if (filter === "off") q = q.eq("allowed", false);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const rows = data ?? [];
  const offCount = rows.filter((r) => !r.allowed).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Geofence audit</h1>
          <p className="text-sm text-muted-foreground">
            Every clock-in / clock-out attempt made while the school geofence is active. Off-site attempts are refused and logged here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border p-1">
            <button
              onClick={() => setFilter("off")}
              className={cn("rounded px-3 py-1.5 text-sm", filter === "off" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >Off-site only</button>
            <button
              onClick={() => setFilter("all")}
              className={cn("rounded px-3 py-1.5 text-sm", filter === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >All attempts</button>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Shown</div>
          <div className="mt-1 text-2xl font-semibold">{rows.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Off-site (this view)</div>
          <div className="mt-1 text-2xl font-semibold text-destructive">{offCount}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">On-site (this view)</div>
          <div className="mt-1 text-2xl font-semibold text-success">{rows.length - offCount}</div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            No {filter === "off" ? "off-site" : ""} attempts recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Staff</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Distance</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Message</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {new Date(r.attempted_at).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.staff_name ?? "—"}</div>
                      <div className="text-xs capitalize text-muted-foreground">
                        {r.department ?? ""}{r.action ? ` · clock ${r.action}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {r.allowed ? (
                        <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
                          <ShieldCheck className="mr-1 h-3 w-3" /> On-site
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
                          <ShieldAlert className="mr-1 h-3 w-3" /> Refused
                        </Badge>
                      )}
                      <div className="mt-1 text-xs text-muted-foreground">
                        on_site: {r.on_site == null ? "unknown" : r.on_site ? "true" : "false"}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.distance_m != null ? (
                        <span className={cn("font-medium", r.on_site === false && "text-destructive")}>
                          {Math.round(Number(r.distance_m))}m
                        </span>
                      ) : "—"}
                      <div className="text-xs text-muted-foreground">
                        allowed: {r.radius_m ?? "—"}m
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {r.lat != null && r.lng != null ? (
                        <a
                          href={`https://www.google.com/maps?q=${r.lat},${r.lng}`}
                          target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <MapPin className="h-3.5 w-3.5" />
                          {Number(r.lat).toFixed(5)}, {Number(r.lng).toFixed(5)}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">no fix</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.error_message ?? (r.allowed ? "Accepted" : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
