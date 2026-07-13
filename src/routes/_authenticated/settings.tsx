import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { MapPin, Crosshair, Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

type Site = {
  id: string;
  site_label: string;
  site_lat: number;
  site_lng: number;
  radius_meters: number;
  active: boolean;
};

// Types not regenerated yet — cast to any for the `sites` table.
const sitesTable = () => (supabase as any).from("sites");

function SettingsPage() {
  const qc = useQueryClient();
  const { data: sites, isLoading } = useQuery({
    queryKey: ["sites"],
    queryFn: async () => {
      const { data, error } = await sitesTable()
        .select("id, site_label, site_lat, site_lng, radius_meters, active")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Site[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (s: Partial<Site> & { id?: string }) => {
      const { error } = await sitesTable().upsert({
        ...(s.id ? { id: s.id } : {}),
        site_label: s.site_label,
        site_lat: s.site_lat,
        site_lng: s.site_lng,
        radius_meters: s.radius_meters,
        active: s.active ?? true,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Site saved");
      qc.invalidateQueries({ queryKey: ["sites"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sitesTable().delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Site removed");
      qc.invalidateQueries({ queryKey: ["sites"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="text-muted-foreground">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sites & Geofence</h1>
        <p className="text-sm text-muted-foreground">
          Add every school location. Staff can clock in/out when they are within the radius of <strong>any</strong> active site.
        </p>
      </div>

      {(sites ?? []).map((s) => (
        <SiteCard
          key={s.id}
          site={s}
          onSave={(next) => upsert.mutate({ ...next, id: s.id })}
          onDelete={() => {
            if (confirm(`Remove site "${s.site_label}"?`)) remove.mutate(s.id);
          }}
          busy={upsert.isPending || remove.isPending}
        />
      ))}

      <NewSiteCard onCreate={(s) => upsert.mutate(s)} busy={upsert.isPending} />
    </div>
  );
}

function SiteCard({
  site, onSave, onDelete, busy,
}: {
  site: Site;
  onSave: (s: Site) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [form, setForm] = useState<Site>(site);
  const [locating, setLocating] = useState(false);
  useEffect(() => setForm(site), [site]);

  function useCurrentLocation() {
    if (!("geolocation" in navigator)) return toast.error("This device has no GPS");
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

  return (
    <Card className="space-y-4 p-6">
      <div className="grid gap-2">
        <Label>Site name</Label>
        <Input value={form.site_label} onChange={(e) => setForm({ ...form, site_label: e.target.value })} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label>Latitude</Label>
          <Input type="number" step="any" value={form.site_lat}
            onChange={(e) => setForm({ ...form, site_lat: Number(e.target.value) })} />
        </div>
        <div className="grid gap-2">
          <Label>Longitude</Label>
          <Input type="number" step="any" value={form.site_lng}
            onChange={(e) => setForm({ ...form, site_lng: Number(e.target.value) })} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label>Allowed radius (meters)</Label>
        <Input type="number" min={10} max={5000} value={form.radius_meters}
          onChange={(e) => setForm({ ...form, radius_meters: Number(e.target.value) || 0 })} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={useCurrentLocation} disabled={locating}>
          <Crosshair className="mr-2 h-4 w-4" />
          {locating ? "Getting location…" : "Use my current location"}
        </Button>
        <a className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm hover:bg-muted"
           target="_blank" rel="noreferrer"
           href={`https://www.google.com/maps?q=${form.site_lat},${form.site_lng}`}>
          <MapPin className="h-4 w-4" /> Preview
        </a>
        <label className="ml-auto inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Active
        </label>
      </div>
      <div className="flex justify-between gap-2 border-t pt-4">
        <Button variant="destructive" onClick={onDelete} disabled={busy}>
          <Trash2 className="mr-2 h-4 w-4" /> Remove
        </Button>
        <Button onClick={() => onSave(form)} disabled={busy}>Save</Button>
      </div>
    </Card>
  );
}

function NewSiteCard({ onCreate, busy }: { onCreate: (s: Partial<Site>) => void; busy: boolean }) {
  const [form, setForm] = useState({ site_label: "", site_lat: 0, site_lng: 0, radius_meters: 150, active: true });
  return (
    <Card className="space-y-4 border-dashed p-6">
      <h2 className="text-lg font-semibold">Add another site</h2>
      <div className="grid gap-2">
        <Label>Site name</Label>
        <Input value={form.site_label} placeholder="e.g. School 3"
          onChange={(e) => setForm({ ...form, site_label: e.target.value })} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label>Latitude</Label>
          <Input type="number" step="any" value={form.site_lat || ""}
            onChange={(e) => setForm({ ...form, site_lat: Number(e.target.value) })} />
        </div>
        <div className="grid gap-2">
          <Label>Longitude</Label>
          <Input type="number" step="any" value={form.site_lng || ""}
            onChange={(e) => setForm({ ...form, site_lng: Number(e.target.value) })} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label>Radius (m)</Label>
        <Input type="number" min={10} max={5000} value={form.radius_meters}
          onChange={(e) => setForm({ ...form, radius_meters: Number(e.target.value) || 0 })} />
      </div>
      <div className="flex justify-end">
        <Button
          onClick={() => {
            if (!form.site_label || !form.site_lat || !form.site_lng) return toast.error("Fill name, lat and lng");
            onCreate(form);
            setForm({ site_label: "", site_lat: 0, site_lng: 0, radius_meters: 150, active: true });
          }}
          disabled={busy}
        >
          <Plus className="mr-2 h-4 w-4" /> Add site
        </Button>
      </div>
    </Card>
  );
}
