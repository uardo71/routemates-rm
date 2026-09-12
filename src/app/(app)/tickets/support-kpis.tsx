import Link from "next/link";
import { AlertTriangleIcon, CheckCircle2Icon, TicketIcon, UserXIcon } from "lucide-react";
import { StatCard } from "@/components/stat-card";

// The four numbers that matter, in the same order on every Support surface. Each one is a link into
// exactly the tickets it counted — the drill-down is the point, not decoration.

const ICON = { open: TicketIcon, breached: AlertTriangleIcon, unassigned: UserXIcon, resolved: CheckCircle2Icon };

export type Kpi = {
  key: keyof typeof ICON;
  label: string;
  value: number;
  href: string;
  sublabel: string;
  tone?: "default" | "destructive" | "warning";
};

export function SupportKpis({ items }: { items: Kpi[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {items.map((k) => (
        <Link key={k.key} href={k.href} className="block rounded-lg ring-primary/40 hover:ring-2">
          <StatCard label={k.label} value={k.value} icon={ICON[k.key]} tone={k.tone ?? "default"} sublabel={k.sublabel} />
        </Link>
      ))}
    </div>
  );
}
