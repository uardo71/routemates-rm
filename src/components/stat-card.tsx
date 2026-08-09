import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  sublabel,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  icon: LucideIcon;
  tone?: "default" | "warning" | "destructive";
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="text-sm text-muted-foreground">{label}</div>
          <div
            className={cn(
              "text-2xl font-semibold tabular-nums",
              tone === "warning" && "text-amber-500",
              tone === "destructive" && "text-destructive"
            )}
          >
            {value}
          </div>
          {sublabel && <div className="text-xs text-muted-foreground">{sublabel}</div>}
        </div>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4.5" />
        </div>
      </CardContent>
    </Card>
  );
}
