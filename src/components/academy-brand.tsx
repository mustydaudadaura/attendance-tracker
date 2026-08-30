import emblemAsset from "@/assets/academy-emblem.jpg.asset.json";
import { cn } from "@/lib/utils";

export function AcademyBrand({
  compact = false,
  light = false,
}: {
  compact?: boolean;
  light?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3", compact && "gap-2")}>
      <img
        src={emblemAsset.url}
        alt="Talented Stars International Schools emblem"
        className={cn(
          "h-14 w-14 shrink-0 rounded-full border-2 object-cover shadow-sm",
          compact && "h-10 w-10",
          light ? "border-primary-foreground/60" : "border-primary/20",
        )}
      />
      <div className="min-w-0">
        <p className={cn(
          "truncate text-[0.68rem] font-semibold uppercase tracking-[0.18em]",
          light ? "text-primary-foreground/80" : "text-primary",
        )}>
          Talented Stars Intl Schools
        </p>
        <p className={cn(
          "truncate font-display text-lg leading-tight",
          compact && "text-base",
          light ? "text-primary-foreground" : "text-foreground",
        )}>
          Assalam Tahfizul Qur&apos;an Academy
        </p>
      </div>
    </div>
  );
}