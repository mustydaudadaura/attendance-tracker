import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Users, Wallet, LogOut, MonitorSmartphone, CalendarOff } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AdminLayout,
});

function AdminLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const nav = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/staff", label: "Staff", icon: Users },
    { to: "/payroll", label: "Payroll", icon: Wallet },
  ] as const;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-widest opacity-80">Assalam Tahfizul Qur'an Academy Ltd</p>
            <h1 className="text-lg font-semibold">Admin Dashboard</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/" className="inline-flex items-center gap-2 rounded-md border border-primary-foreground/30 px-3 py-2 text-sm hover:bg-primary-foreground/10">
              <MonitorSmartphone className="h-4 w-4" /> Kiosk
            </Link>
            <Button variant="secondary" size="sm" onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 px-6">
          {nav.map((n) => {
            const active = pathname.startsWith(n.to);
            const Icon = n.icon;
            return (
              <Link key={n.to} to={n.to} className={cn(
                "-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm transition-colors",
                active ? "border-gold text-primary-foreground" : "border-transparent text-primary-foreground/70 hover:text-primary-foreground",
              )}>
                <Icon className="h-4 w-4" /> {n.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8"><Outlet /></main>
    </div>
  );
}
