import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { MapPin, Crosshair } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

type Settings = {
  site_lat: number | null;
  site_lng: number | null;
  radius_meters: number;
  site_label: string;
};

function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["site_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_settings")
        .select("site_lat, site_lng, radius_meters, site_label")
        .eq("id", true)
        .maybeSingle();
      if (error) throw error;
      return (data ?? { site_lat: null, site_lng: null, radius_meters: 150, site_label: "School" }) as Settings;
    },
  });

  const [form, setForm] = useState<Settings>({ site_lat: null, site_lng: null, radius_meters: 150, site_label: "School" });
  const [locating, setLocating] = useState(false);

  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = useMutation({
    mutationFn: async (s: Settings) => {
      const { error } = await supabase.from("site_settings").upsert({
        id: true,
        site_lat: s.site_lat,
        site_lng: s.site_lng,
        radius_meters: s.radius_meters,
        site_label: s.site_label,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Geofence settings saved");
      qc.invalidateQueries({ queryKey: ["site_settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function useCurrentLocation() {
    if (!("geolocation" in navigator)) { toast.error("This device has no GPS"); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({ ...f, site_lat: pos.coords.latitude, site_lng: pos.coords.longitude }));
        setLocating(false);
        toast.success("Location captured — remember to Save");
      },
      (err) => { setLocating(false); toast.error(err.message); },
      { enableHighAccuracy: true, timeout: 20_000 },
    );
  }

  if (isLoading) return <div className="text-muted-foreground">Loading…</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Site & Geofence</h1>
        <p className="text-sm text-muted-foreground">
          Set the school's coordinates and the allowed radius. Staff must be within this radius to clock in or out.
        </p>
      </div>

      <Card className="space-y-4 p-6">
        <div className="grid gap-2">
          <Label htmlFor="label">Site name</Label>
          <Input id="label" value={form.site_label}
            onChange={(e) => setForm({ ...form, site_label: e.target.value })} />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="lat">Latitude</Label>
            <Input id="lat" type="number" step="any" value={form.site_lat ?? ""}
              onChange={(e) => setForm({ ...form, site_lat: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="e.g. 6.5244" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lng">Longitude</Label>
            <Input id="lng" type="number" step="any" value={form.site_lng ?? ""}
              onChange={(e) => setForm({ ...form, site_lng: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="e.g. 3.3792" />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="radius">Allowed radius (meters)</Label>
          <Input id="radius" type="number" min={10} max={5000} value={form.radius_meters}
            onChange={(e) => setForm({ ...form, radius_meters: Number(e.target.value) || 0 })} />
          <p className="text-xs text-muted-foreground">Typical values: 50–300m. Larger values are more forgiving of weak GPS.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={useCurrentLocation} disabled={locating}>
            <Crosshair className="mr-2 h-4 w-4" />
            {locating ? "Getting location…" : "Use my current location"}
          </Button>
          {form.site_lat != null && form.site_lng != null && (
            <a
              className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm hover:bg-muted"
              target="_blank" rel="noreferrer"
              href={`https://www.google.com/maps?q=${form.site_lat},${form.site_lng}`}
            >
              <MapPin className="h-4 w-4" /> Preview on map
            </a>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save settings"}
          </Button>
        </div>

        {form.site_lat == null && (
          <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            No coordinates set yet — geofence is disabled and staff can clock in from anywhere. Set the location to enforce on-site attendance.
          </p>
        )}
      </Card>
    </div>
  );
}
