import { cn } from "@/lib/utils";
import { GraduationCap } from "lucide-react";

export function AcademyBrand({
  compact = false,
  light = false,
}: {
  compact?: boolean;
  light?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3", compact && "gap-2.5")}>
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full border-2 shadow-sm transition-transform",
          compact ? "h-10 w-10" : "h-13 w-13",
          light
            ? "border-primary-foreground/40 bg-primary-foreground/15 text-primary-foreground"
            : "border-primary/30 bg-primary/10 text-primary",
        )}
        aria-label="Aljazeera International School Daura crest"
      >
        <GraduationCap className={cn(compact ? "h-5 w-5" : "h-7 w-7")} />
      </div>
      <div className="min-w-0">
        <p
          className={cn(
            "text-[0.68rem] font-semibold uppercase tracking-[0.18em]",
            light ? "text-primary-foreground/80" : "text-primary",
          )}
        >
          Staff Attendance &amp; Payroll
        </p>
        <p
          className={cn(
            "font-display font-semibold leading-tight",
            compact ? "text-base" : "text-xl",
            light ? "text-primary-foreground" : "text-foreground",
          )}
        >
          Aljazeera International School Daura
        </p>
      </div>
    </div>
  );
}