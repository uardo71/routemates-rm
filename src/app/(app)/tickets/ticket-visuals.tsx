"use client";

import {
  AlertTriangleIcon, LifeBuoyIcon, GitPullRequestIcon, SearchIcon, BugIcon,
  SquareCheckIcon, CircleHelpIcon, TicketIcon, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { statusColor } from "@/lib/ticket-config";

const TYPE_ICONS: Record<string, LucideIcon> = {
  incident: AlertTriangleIcon,
  service: LifeBuoyIcon,
  change: GitPullRequestIcon,
  problem: SearchIcon,
  bug: BugIcon,
  task: SquareCheckIcon,
  question: CircleHelpIcon,
  ticket: TicketIcon,
};

export function TypeIcon({ icon, className }: { icon: string | null; className?: string }) {
  const Icon = TYPE_ICONS[icon ?? "ticket"] ?? TicketIcon;
  return <Icon className={cn("size-4", className)} />;
}

export function TypeChip({ name, color, icon }: { name: string; color: string | null; icon: string | null }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", statusColor(color).chip)}>
      <TypeIcon icon={icon} className="size-3" /> {name}
    </span>
  );
}

export function StatusChip({ name, color, className }: { name: string; color: string | null; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", statusColor(color).chip, className)}>{name}</span>;
}

export function StatusDot({ color, className }: { color: string | null; className?: string }) {
  return <span className={cn("size-2 shrink-0 rounded-full", statusColor(color).dot, className)} />;
}
