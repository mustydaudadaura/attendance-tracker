import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Delete, LogIn, LogOut, MapPin, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: Kiosk,
  ssr: false,
});

type PunchResult = {
  ok: boolean;
  error?: string;
  action?: "in" | "out";
  staff_name?: string;
  department?: string;
  clock_in?: string;
  clock_out?: string;
  late_minutes?: number;
  deduction_percent?: number;
  early_minutes?: number;
  on_time?: boolean;
  lat?: number;
  lng?: number;
  address?: string;
};

type Fix = { lat: number; lng: number; address?: string; at: number };

const FIX_KEY = "kiosk_last_fix";
const FIX_MAX_AGE_MS = 30 * 60_000; // treat cached fix as usable for 30 minutes



function loadStoredFix(): Fix | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FIX_KEY);
    if (!raw) return null;
    const f = JSON.parse(raw) as Fix;
    if (!f?.lat || !f?.lng) return null;
    return f;
  } catch { return null; }
}
function saveStoredFix(f: Fix) {
  try { window.localStorage.setItem(FIX_KEY, JSON.stringify(f)); } catch { /* ignore */ }
}

function Kiosk() {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PunchResult | null>(null);
  const [now, setNow] = useState(new Date());
  const [geoStatus, setGeoStatus] = useState<"idle" | "locating" | "ready" | "cached" | "denied" | "blocked" | "unsupported">("idle");
  const [geoError, setGeoError] = useState<string | null>(null);
  const fixRef = useRef<Fix | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const inIframe = typeof window !== "undefined" && window.self !== window.top;

  const applyFix = useCallback(async (lat: number, lng: number) => {
    const fix: Fix = { lat, lng, at: Date.now() };
    fixRef.current = fix;
    saveStoredFix(fix);
    setGeoStatus("ready");
    setGeoError(null);
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=17`,
        { headers: { "Accept-Language": "en" } },
      );
      const j = await r.json();
      if (j?.display_name && fixRef.current) {
        fixRef.current = { ...fixRef.current, address: j.display_name as string };
        saveStoredFix(fixRef.current);
      }
    } catch { /* ignore */ }
  }, []);

  const handleGeoError = useCallback((err: GeolocationPositionError) => {
    const policyBlocked = /permissions policy|disabled in this document/i.test(err.message);
    if (err.code === 1 && policyBlocked) {
      setGeoStatus("blocked");
      setGeoError("Location is disabled in this window. Open the published kiosk URL and allow location.");
    } else if (err.code === 1) {
      setGeoStatus("denied");
      setGeoError("Permission denied. Tap the lock icon in the address bar and allow Location.");
    } else if (fixRef.current && Date.now() - fixRef.current.at < FIX_MAX_AGE_MS) {
      // We have a recent cached fix — keep using it and don't scare the user.
      setGeoStatus("cached");
      setGeoError(null);
    } else {
      setGeoStatus("denied");
      setGeoError(err.message || "Could not get a fresh location. Using last known if available.");
    }
  }, []);

  // Prefetch + keep-fresh via watchPosition; falls back to low-accuracy request.
  const refreshFix = useCallback(() => {
    if (!("geolocation" in navigator)) { setGeoStatus("unsupported"); return; }
    setGeoStatus((s) => (s === "ready" || s === "cached" ? s : "locating"));

    // 1) One quick high-accuracy attempt.
    navigator.geolocation.getCurrentPosition(
      (pos) => applyFix(pos.coords.latitude, pos.coords.longitude),
      () => {
        // 2) Retry with relaxed accuracy & longer timeout — works indoors / weak GPS.
        navigator.geolocation.getCurrentPosition(
          (pos) => applyFix(pos.coords.latitude, pos.coords.longitude),
          handleGeoError,
          { enableHighAccuracy: false, timeout: 20_000, maximumAge: 5 * 60_000 },
        );
      },
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 60_000 },
    );

    // 3) Also keep a watcher so the fix stays fresh in the background.
    if (watchIdRef.current == null) {
      try {
        watchIdRef.current = navigator.geolocation.watchPosition(
          (pos) => applyFix(pos.coords.latitude, pos.coords.longitude),
          handleGeoError,
          { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
        );
      } catch { /* ignore */ }
    }
  }, [applyFix, handleGeoError]);

  // Hydrate from localStorage so the kiosk starts "ready" even before a fresh fix.
  useEffect(() => {
    const cached = loadStoredFix();
    if (cached) {
      fixRef.current = cached;
      setGeoStatus(Date.now() - cached.at < FIX_MAX_AGE_MS ? "cached" : "locating");
    }
    refreshFix();
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [refreshFix]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => { setResult(null); setPin(""); refreshFix(); }, 8000);
    return () => clearTimeout(t);
  }, [result, refreshFix]);


  async function submit(intent: "in" | "out") {
    if (pin.length !== 4 || busy) return;
    setBusy(true);
    const fix = fixRef.current;
    const { data, error } = await supabase.rpc("punch_clock", {
      p_pin: pin,
      p_lat: fix?.lat ?? null,
      p_lng: fix?.lng ?? null,
      p_address: fix?.address ?? null,
    });
    setBusy(false);
    if (error) { setResult({ ok: false, error: error.message }); return; }
    const res = data as unknown as PunchResult;
    if (res.ok && res.action && res.action !== intent) {
      setResult({
        ok: false,
        error: intent === "in"
          ? "You have already clocked in today. Press Sign Out instead."
          : "You have not clocked in yet. Press Sign In first.",
      });
      return;
    }
    setResult(res);
  }

  function press(d: string) {
    if (result) setResult(null);
    setPin((p) => (p.length < 4 ? p + d : p));
  }

  const late = result?.ok && result.on_time === false;
  const good = result?.ok && result.on_time === true;
  const lagosWeekday = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Lagos", weekday: "long" }).format(now);
  const isWeekend = lagosWeekday === "Saturday" || lagosWeekday === "Sunday";
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const { data: holidayLabel } = useQuery({
    queryKey: ["holiday", todayIso],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_todays_holiday");
      if (error) throw error;
      return (data ?? null) as string | null;
    },
    refetchInterval: 5 * 60_000,
  });
  const isHoliday = !!holidayLabel;
  const isClosed = isWeekend || isHoliday;
  const closedTitle = isHoliday ? `Holiday — ${holidayLabel}` : `Kiosk closed — ${lagosWeekday}`;
  const closedMsg = isHoliday
    ? "Sign-in and sign-out are disabled today. Enjoy the holiday!"
    : "Sign-in and sign-out are disabled on Saturdays and Sundays. Please clock in on the next working day (Monday).";

  const currentFix = fixRef.current;

  // Fetch geofence status (radius/label + optionally computed distance) via a
  // SECURITY DEFINER RPC that never leaks the site's exact coordinates.
  const { data: siteInfo } = useQuery({
    queryKey: ["site_info", currentFix?.lat ?? null, currentFix?.lng ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_kiosk_site_info", {
        p_lat: currentFix?.lat ?? undefined,
        p_lng: currentFix?.lng ?? undefined,
      });
      if (error) throw error;
      return data as {
        enabled: boolean;
        radius_meters?: number;
        site_label?: string;
        distance_m?: number;
        on_site?: boolean;
      };
    },
    refetchInterval: 5 * 60_000,
  });

  const geofenceEnabled = !!siteInfo?.enabled;
  const distanceM = typeof siteInfo?.distance_m === "number" ? siteInfo.distance_m : null;
  const onSite = typeof siteInfo?.on_site === "boolean" ? siteInfo.on_site : null;
  const site = geofenceEnabled
    ? { radius_meters: siteInfo!.radius_meters ?? 150, site_label: siteInfo!.site_label ?? "site" }
    : null;
  const geofenceBlocks = geofenceEnabled && (onSite === false || (onSite === null && (geoStatus === "denied" || geoStatus === "blocked" || geoStatus === "unsupported")));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-widest opacity-80">Assalam Tahfizul Qur'an Academy Ltd</p>
            <h1 className="text-lg font-semibold">Staff Attendance Kiosk</h1>
          </div>
          <Link to="/auth" className="inline-flex items-center gap-2 rounded-md border border-primary-foreground/30 px-3 py-2 text-sm hover:bg-primary-foreground/10">
            <ShieldCheck className="h-4 w-4" /> Admin
          </Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-8 px-6 py-10 md:grid-cols-2">
        <Card className="p-8">
          <div className="mb-2 text-sm text-muted-foreground">Local time (Lagos)</div>
          <div className="font-display text-5xl font-semibold tabular-nums text-primary">
            {now.toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {now.toLocaleDateString("en-NG", { timeZone: "Africa/Lagos", weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </div>

          <div className="mt-6 flex items-center gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={cn(
                "flex h-14 w-14 items-center justify-center rounded-lg border-2 text-2xl font-bold",
                pin[i] ? "border-primary bg-primary/5" : "border-muted",
              )}>{pin[i] ? "•" : ""}</div>
            ))}
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3">
            {["1","2","3","4","5","6","7","8","9"].map((d) => (
              <Button key={d} variant="outline" className="h-14 text-xl" onClick={() => press(d)}>{d}</Button>
            ))}
            <Button variant="outline" className="h-14" onClick={() => setPin("")}>Clear</Button>
            <Button variant="outline" className="h-14 text-xl" onClick={() => press("0")}>0</Button>
            <Button variant="outline" className="h-14" onClick={() => setPin((p) => p.slice(0, -1))}>
              <Delete className="h-5 w-5" />
            </Button>
          </div>

          {isClosed && (
            <div className="mt-6 rounded-lg border-2 border-destructive/50 bg-destructive/10 p-4 text-center">
              <p className="text-base font-bold text-destructive">{closedTitle}</p>
              <p className="mt-1 text-sm text-destructive/90">{closedMsg}</p>
            </div>
          )}

          {!isClosed && geofenceEnabled && (
            <div className={cn(
              "mt-6 rounded-lg border-2 p-3 text-center text-sm",
              onSite === true && "border-success/50 bg-success/10 text-success",
              onSite === false && "border-destructive/50 bg-destructive/10 text-destructive",
              onSite === null && "border-muted bg-muted/40 text-muted-foreground",
            )}>
              {onSite === true && (
                <p><strong>On-site at {site!.site_label}</strong> · {Math.round(distanceM!)}m from center (allowed: {site!.radius_meters}m)</p>
              )}
              {onSite === false && (
                <p><strong>Off-site.</strong> You are {Math.round(distanceM!)}m from {site!.site_label}. Move within {site!.radius_meters}m to clock in.</p>
              )}
              {onSite === null && (
                <p>Waiting for location to verify you are within {site!.radius_meters}m of {site!.site_label}…</p>
              )}
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-3">
            <Button
              className="h-14 text-base bg-success text-success-foreground hover:bg-success/90"
              disabled={pin.length !== 4 || busy || isClosed || geofenceBlocks}
              onClick={() => submit("in")}
            >
              <LogIn className="mr-2 h-5 w-5" /> {busy ? "…" : "Sign In"}
            </Button>
            <Button
              variant="destructive"
              className="h-14 text-base"
              disabled={pin.length !== 4 || busy || isClosed || geofenceBlocks}
              onClick={() => submit("out")}
            >
              <LogOut className="mr-2 h-5 w-5" /> {busy ? "…" : "Sign Out"}
            </Button>
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {isClosed ? "Work week is Monday to Friday (holidays excluded)." : "Enter your 4-digit PIN, then press Sign In or Sign Out."}
          </p>
          <div className="mt-2 space-y-1 text-center text-xs">
            <div className="flex items-center justify-center gap-1.5">
              <MapPin className={cn(
                "h-3.5 w-3.5",
                (geoStatus === "ready" || geoStatus === "cached") && "text-success",
                (geoStatus === "denied" || geoStatus === "blocked" || geoStatus === "unsupported") && "text-destructive",
                (geoStatus === "locating" || geoStatus === "idle") && "text-muted-foreground",
              )} />
              <span className={cn(
                (geoStatus === "ready" || geoStatus === "cached") && "text-success",
                (geoStatus === "denied" || geoStatus === "blocked" || geoStatus === "unsupported") && "text-destructive font-medium",
                (geoStatus === "locating" || geoStatus === "idle") && "text-muted-foreground",
              )}>
                {geoStatus === "ready" && "Location ready"}
                {geoStatus === "cached" && "Location ready (last known)"}
                {geoStatus === "locating" && "Getting location…"}
                {geoStatus === "denied" && "Location unavailable — you can still sign in"}
                {geoStatus === "blocked" && "Location blocked in preview"}
                {geoStatus === "unsupported" && "This device has no GPS — you can still sign in"}
                {geoStatus === "idle" && "Preparing location…"}
              </span>
              {(geoStatus === "denied" || geoStatus === "blocked" || geoStatus === "cached") && (
                <button type="button" onClick={refreshFix} className="ml-1 underline">refresh</button>
              )}
            </div>
            {geoError && (
              <p className="text-destructive/80">{geoError}</p>
            )}
            {geoStatus === "blocked" && inIframe && (
              <a
                href="https://assslamattend.lovable.app"
                target="_blank"
                rel="noreferrer"
                className="inline-block font-semibold text-primary underline"
              >
                Open kiosk in a new tab →
              </a>
            )}
          </div>


        </Card>

        <Card className={cn(
          "flex flex-col justify-center p-8 transition-colors",
          good && "bg-success/10 border-success",
          late && "bg-destructive/10 border-destructive",
          result && !result.ok && "bg-destructive/10 border-destructive",
        )}>
          {!result && (
            <div className="text-center text-muted-foreground">
              <p className="mb-2 text-sm">Ready</p>
              <p className="text-lg">Please enter your PIN to clock in or out.</p>
            </div>
          )}

          {result && !result.ok && (
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-destructive text-destructive-foreground">✕</div>
              <h2 className="text-xl font-semibold text-destructive">{result.error}</h2>
            </div>
          )}

          {result?.ok && (
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 text-sm uppercase tracking-widest text-muted-foreground">
                {result.action === "in" ? <LogIn className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}
                Clock {result.action === "in" ? "In" : "Out"}
              </div>
              <h2 className="mt-2 text-3xl font-bold">{result.staff_name}</h2>
              <p className="text-sm capitalize text-muted-foreground">{result.department} department</p>

              <div className={cn(
                "mt-6 font-display text-5xl font-bold tabular-nums",
                good ? "text-success" : "text-destructive",
              )}>
                {new Date((result.action === "in" ? result.clock_in : result.clock_out) as string)
                  .toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" })}
              </div>

              {result.action === "in" && (
                good ? (
                  <p className="mt-3 rounded-md bg-success/20 px-4 py-2 text-sm font-medium text-success">
                    On time — no deduction
                  </p>
                ) : (
                  <div className="mt-3 space-y-1 rounded-md bg-destructive/15 px-4 py-3 text-sm text-destructive">
                    <p className="font-semibold">Late by {result.late_minutes} minute{result.late_minutes === 1 ? "" : "s"}</p>
                    <p>Deduction: {Number(result.deduction_percent)}% of daily pay</p>
                  </div>
                )
              )}

              {result.action === "out" && (
                Number(result.early_minutes) > 0 ? (
                  <div className="mt-3 space-y-1 rounded-md bg-destructive/15 px-4 py-3 text-sm text-destructive">
                    <p className="font-semibold">Early by {result.early_minutes} minute{result.early_minutes === 1 ? "" : "s"}</p>
                    <p>Extra deduction added · Total today: {Number(result.deduction_percent)}%</p>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">Have a safe trip home.</p>
                )
              )}

              {(result.address || result.lat) && (
                <div className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-left text-xs">
                  <div className="flex items-center gap-1 font-semibold text-foreground">
                    <MapPin className="h-3.5 w-3.5" /> Location captured
                  </div>
                  {result.address && <p className="mt-1 text-muted-foreground">{result.address}</p>}
                  {result.lat != null && result.lng != null && (
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {Number(result.lat).toFixed(5)}, {Number(result.lng).toFixed(5)}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      </main>

      <section className="mx-auto max-w-5xl px-6 pb-12">
        <PenaltyBoard />
      </section>
    </div>
  );
}

type SummaryRow = {
  staff_id: string;
  full_name: string;
  department: string;
  clock_in: string | null;
  clock_out: string | null;
  late_minutes: number;
  deduction_percent: number;
  status: "on-time" | "late" | "in" | "missed-out" | "absent" | "not-yet";
};

function lagosDate(offsetDays = 0) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  return fmt.format(now); // yyyy-mm-dd
}

function useDaySummary(dateStr: string) {
  return useQuery({
    queryKey: ["penalty-summary", dateStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("daily_penalty_summary" as never, { p_date: dateStr } as never);
      if (error) throw error;
      return (data ?? []) as unknown as SummaryRow[];
    },
    refetchInterval: 60_000,
  });
}

function PenaltyBoard() {
  const today = lagosDate(0);
  const yesterday = lagosDate(-1);
  const todayQ = useDaySummary(today);
  const yestQ = useDaySummary(yesterday);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <DayCard title="Today" dateStr={today} rows={todayQ.data ?? []} loading={todayQ.isLoading} />
      <DayCard title="Yesterday" dateStr={yesterday} rows={yestQ.data ?? []} loading={yestQ.isLoading} />
    </div>
  );
}

function DayCard({ title, dateStr, rows, loading }: { title: string; dateStr: string; rows: SummaryRow[]; loading: boolean }) {
  const pretty = new Date(dateStr + "T00:00:00").toLocaleDateString("en-NG", {
    weekday: "short", day: "numeric", month: "short",
  });
  const totals = rows.reduce(
    (acc, r) => {
      if (r.status === "on-time") acc.onTime++;
      else if (r.status === "late") acc.late++;
      else if (r.status === "in") acc.stillIn++;
      else if (r.status === "missed-out") acc.missedOut++;
      else if (r.status === "absent") acc.absent++;
      acc.penaltyPct += Number(r.deduction_percent) || 0;
      return acc;
    },
    { onTime: 0, late: 0, stillIn: 0, missedOut: 0, absent: 0, penaltyPct: 0 },
  );

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-lg font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">{pretty}</span>
      </div>

      <div className="mb-4 grid grid-cols-5 gap-2 text-center text-xs">
        <Stat label="On time" value={totals.onTime} tone="success" />
        <Stat label="Late" value={totals.late} tone="warn" />
        <Stat label="Still in" value={totals.stillIn} tone="muted" />
        <Stat label="Missed out" value={totals.missedOut} tone="danger" />
        <Stat label="Absent" value={totals.absent} tone="danger" />
      </div>

      <div className="max-h-72 overflow-y-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/70 text-left uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Staff</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Late</th>
              <th className="px-3 py-2 text-right">Penalty</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">No staff.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.staff_id} className="border-t">
                <td className="px-3 py-2 font-medium">{r.full_name}</td>
                <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.late_minutes > 0 ? `${r.late_minutes}m` : "—"}
                </td>
                <td className={cn(
                  "px-3 py-2 text-right font-semibold tabular-nums",
                  Number(r.deduction_percent) > 0 ? "text-destructive" : "text-success",
                )}>
                  {Number(r.deduction_percent) > 0 ? `${Number(r.deduction_percent)}%` : "0%"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "success" | "warn" | "danger" | "muted" }) {
  const toneClass =
    tone === "success" ? "bg-success/15 text-success" :
    tone === "warn" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" :
    tone === "danger" ? "bg-destructive/15 text-destructive" :
    "bg-muted text-muted-foreground";
  return (
    <div className={cn("rounded-md px-2 py-2", toneClass)}>
      <div className="text-lg font-bold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide">{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: SummaryRow["status"] }) {
  const map: Record<SummaryRow["status"], { label: string; cls: string }> = {
    "on-time": { label: "On time", cls: "bg-success/15 text-success" },
    "late": { label: "Late", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
    "in": { label: "Signed in", cls: "bg-primary/15 text-primary" },
    "missed-out": { label: "No sign-out", cls: "bg-destructive/15 text-destructive" },
    "absent": { label: "Absent", cls: "bg-destructive/15 text-destructive" },
    "not-yet": { label: "—", cls: "bg-muted text-muted-foreground" },
  };
  const { label, cls } = map[status];
  return <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase", cls)}>{label}</span>;
}
