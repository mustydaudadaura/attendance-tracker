import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Pencil, History, ArrowDownToLine, Loader2 } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  downloadWeekSummary, downloadMonthSummary, isoMondayOf, currentMonthIsoLagos,
} from "@/lib/staff-summary";

export const Route = createFileRoute("/_authenticated/staff")({ component: StaffPage });

type Staff = {
  id: string;
  full_name: string;
  department: "nursery" | "primary";
  pin: string;
  base_salary: number;
  active: boolean;
};

function StaffPage() {
  const qc = useQueryClient();
  const { data: staff = [] } = useQuery({
    queryKey: ["staff"],
    queryFn: async () => {
      const { data, error } = await supabase.from("staff").select("*").order("full_name");
      if (error) throw error;
      return data as Staff[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Staff removed"); qc.invalidateQueries({ queryKey: ["staff"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Staff</h2>
          <p className="text-sm text-muted-foreground">Register staff, assign a unique 4-digit PIN, and set base salary.</p>
        </div>
        <StaffDialog trigger={<Button><Plus className="mr-2 h-4 w-4" /> Add staff</Button>} />
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">PIN</th>
                <th className="px-4 py-3 text-right">Base salary</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No staff yet. Click "Add staff" to register the first one.</td></tr>
              )}
              {staff.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="px-4 py-3 font-medium">{s.full_name}</td>
                  <td className="px-4 py-3 capitalize">{s.department}</td>
                  <td className="px-4 py-3 font-mono tracking-widest">{s.pin}</td>
                  <td className="px-4 py-3 text-right">₦{Number(s.base_salary).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    {s.active ? <Badge className="bg-success text-success-foreground hover:bg-success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link to="/staff/$staffId" params={{ staffId: s.id }}>
                          <History className="mr-1 h-4 w-4" /> History
                        </Link>
                      </Button>
                      <StaffDialog existing={s} trigger={<Button size="sm" variant="outline"><Pencil className="h-4 w-4" /></Button>} />
                      <Button size="sm" variant="outline" onClick={() => { if (confirm(`Delete ${s.full_name}?`)) del.mutate(s.id); }}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
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

function StaffDialog({ existing, trigger }: { existing?: Staff; trigger: React.ReactNode }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState(existing?.full_name ?? "");
  const [department, setDepartment] = useState<Staff["department"]>(existing?.department ?? "primary");
  const [pin, setPin] = useState(existing?.pin ?? "");
  const [salary, setSalary] = useState(String(existing?.base_salary ?? ""));
  const [active, setActive] = useState(existing?.active ?? true);

  const save = useMutation({
    mutationFn: async () => {
      if (!/^\d{4}$/.test(pin)) throw new Error("PIN must be exactly 4 digits");
      if (!fullName.trim()) throw new Error("Name is required");
      const payload = {
        full_name: fullName.trim(),
        department, pin,
        base_salary: Number(salary || 0),
        active,
      };
      if (existing) {
        const { error } = await supabase.from("staff").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("staff").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(existing ? "Staff updated" : "Staff added");
      qc.invalidateQueries({ queryKey: ["staff"] });
      setOpen(false);
      if (!existing) { setFullName(""); setPin(""); setSalary(""); }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{existing ? "Edit staff" : "Add staff"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="name">Full name</Label>
            <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label>Department</Label>
            <Select value={department} onValueChange={(v) => setDepartment(v as Staff["department"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nursery">Nursery (closes 12:40)</SelectItem>
                <SelectItem value="primary">Primary (closes 13:10)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="pin">4-digit PIN</Label>
            <Input id="pin" inputMode="numeric" maxLength={4} value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="font-mono tracking-widest" />
          </div>
          <div>
            <Label htmlFor="salary">Monthly base salary (₦)</Label>
            <Input id="salary" inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
