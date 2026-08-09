"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboardIcon,
  FolderKanbanIcon,
  ClockIcon,
  CheckSquareIcon,
  ReceiptIcon,
  UsersIcon,
  Building2Icon,
  CalendarRangeIcon,
  ArrowLeftRightIcon,
  GaugeIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = {
  dashboard: LayoutDashboardIcon,
  projects: FolderKanbanIcon,
  time: ClockIcon,
  approvals: CheckSquareIcon,
  invoices: ReceiptIcon,
  users: UsersIcon,
  clients: Building2Icon,
  planning: CalendarRangeIcon,
  exchangeRates: ArrowLeftRightIcon,
  scheduledVsActuals: GaugeIcon,
} as const;

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };
export type NavGroup = { label: string; items: NavItem[] };

export function SidebarNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-4 px-2">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <div className="px-3 pb-1 text-[11px] font-medium tracking-wide text-sidebar-foreground/50 uppercase">
            {group.label}
          </div>
          {group.items.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = ICONS[item.icon];
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon className="size-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
