import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
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

function Kiosk() {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PunchResult | null>(null);
  const [now, setNow] = useState(new Date());
  const [geoStatus, setGeoStatus] = useState<"idle" | "locating" | "ready" | "denied" | "blocked" | "unsupported">("idle");
  const [geoError, setGeoError] = useState<string | null>(null);
  const fixRef = useRef<Fix | null>(null);
  const inIframe = typeof window !== "undefined" && window.self !== window.top;

  // Prefetch location as soon as the kiosk mounts so submit is instant.
  const refreshFix = useCallback(() => {
    setGeoError(null);
    if (!("geolocation" in navigator)) { setGeoStatus("unsupported"); return; }
    setGeoStatus((s) => (s === "ready" ? s : "locating"));
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        fixRef.current = { lat, lng, at: Date.now() };
        setGeoStatus("ready");
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=17`,
            { headers: { "Accept-Language": "en" } },
          );
          const j = await r.json();
          if (j?.display_name && fixRef.current) {
            fixRef.current = { ...fixRef.current, address: j.display_name as string };
          }
        } catch { /* ignore */ }
      },
      (err) => {
        // code 1 = PERMISSION_DENIED. Distinguish policy-blocked (iframe) vs user-denied.
        const policyBlocked = /permissions policy|disabled in this document/i.test(err.message);
        if (err.code === 1 && policyBlocked) {
          setGeoStatus("blocked");
          setGeoError("Location is disabled in this preview window. Open the published kiosk URL and allow location.");
        } else if (err.code === 1) {
          setGeoStatus("denied");
          setGeoError("Permission denied. Tap the lock icon in the address bar and allow Location.");
        } else {
          setGeoStatus("denied");
          setGeoError(err.message || "Could not get location. Check GPS / location services.");
        }
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  }, []);

  useEffect(() => { refreshFix(); }, [refreshFix]);


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

          <div className="mt-6 grid grid-cols-2 gap-3">
            <Button
              className="h-14 text-base bg-success text-success-foreground hover:bg-success/90"
              disabled={pin.length !== 4 || busy}
              onClick={() => submit("in")}
            >
              <LogIn className="mr-2 h-5 w-5" /> {busy ? "…" : "Sign In"}
            </Button>
            <Button
              variant="destructive"
              className="h-14 text-base"
              disabled={pin.length !== 4 || busy}
              onClick={() => submit("out")}
            >
              <LogOut className="mr-2 h-5 w-5" /> {busy ? "…" : "Sign Out"}
            </Button>
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Enter your 4-digit PIN, then press Sign In or Sign Out.
          </p>
          <div className="mt-2 space-y-1 text-center text-xs">
            <div className="flex items-center justify-center gap-1.5">
              <MapPin className={cn(
                "h-3.5 w-3.5",
                geoStatus === "ready" && "text-success",
                (geoStatus === "denied" || geoStatus === "blocked" || geoStatus === "unsupported") && "text-destructive",
                (geoStatus === "locating" || geoStatus === "idle") && "text-muted-foreground",
              )} />
              <span className={cn(
                geoStatus === "ready" && "text-success",
                (geoStatus === "denied" || geoStatus === "blocked" || geoStatus === "unsupported") && "text-destructive font-medium",
                (geoStatus === "locating" || geoStatus === "idle") && "text-muted-foreground",
              )}>
                {geoStatus === "ready" && "Location ready"}
                {geoStatus === "locating" && "Getting location…"}
                {geoStatus === "denied" && "Location permission denied"}
                {geoStatus === "blocked" && "Location blocked in preview"}
                {geoStatus === "unsupported" && "This device has no GPS"}
                {geoStatus === "idle" && "Location required"}
              </span>
              {(geoStatus === "denied" || geoStatus === "blocked") && (
                <button type="button" onClick={refreshFix} className="ml-1 underline">retry</button>
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
    </div>
  );
}
