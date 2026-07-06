import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Delete, LogIn, LogOut, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Kiosk });

type PunchResult = {
  ok: boolean;
  error?: string;
  action?: "in" | "out";
  staff_name?: string;
  department?: string;
  clock_in?: string;
  clock_out?: string;
  late_minutes?: number;
  deduction_amount?: number;
  on_time?: boolean;
};

function Kiosk() {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PunchResult | null>(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => { setResult(null); setPin(""); }, 8000);
    return () => clearTimeout(t);
  }, [result]);

  async function submit() {
    if (pin.length !== 4 || busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("punch_clock", { p_pin: pin });
    setBusy(false);
    if (error) { setResult({ ok: false, error: error.message }); return; }
    setResult(data as unknown as PunchResult);
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

          <Button
            className="mt-6 h-14 w-full text-base"
            disabled={pin.length !== 4 || busy}
            onClick={submit}
          >
            {busy ? "Processing…" : "Clock In / Out"}
          </Button>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Enter your 4-digit PIN. First tap of the day = Clock In. Next tap = Clock Out.
          </p>
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
                    <p>Deduction: ₦{Number(result.deduction_amount).toLocaleString()}</p>
                  </div>
                )
              )}

              {result.action === "out" && (
                <p className="mt-3 text-sm text-muted-foreground">Have a safe trip home.</p>
              )}
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
