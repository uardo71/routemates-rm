"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronRightIcon,
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
  PalmtreeIcon,
  WalletIcon,
  TagIcon,
  CalendarDaysIcon,
  TargetIcon,
  TrendingUpIcon,
  PiggyBankIcon,
  LandmarkIcon,
  HandCoinsIcon,
  CompassIcon,
  LifeBuoyIcon,
  RocketIcon,
  ClipboardCheckIcon,
  BookOpenIcon,
  TicketIcon,
  SettingsIcon,
  HistoryIcon,
  LayoutListIcon,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const ICONS = {
  dashboard: LayoutDashboardIcon,
  command: GaugeIcon,
  projects: FolderKanbanIcon,
  time: ClockIcon,
  vacations: PalmtreeIcon,
  approvals: CheckSquareIcon,
  invoices: ReceiptIcon,
  users: UsersIcon,
  clients: Building2Icon,
  planning: CalendarRangeIcon,
  exchangeRates: ArrowLeftRightIcon,
  scheduledVsActuals: GaugeIcon,
  expenses: WalletIcon,
  expenseCategories: TagIcon,
  taxes: LandmarkIcon,
  vendors: HandCoinsIcon,
  delivery: CompassIcon,
  portfolio: LayoutListIcon,
  cutover: RocketIcon,
  uat: ClipboardCheckIcon,
  guides: LifeBuoyIcon,
  tickets: TicketIcon,
  help: BookOpenIcon,
  myPlanning: CalendarDaysIcon,
  opportunities: TargetIcon,
  revenue: TrendingUpIcon,
  budgets: PiggyBankIcon,
  settings: SettingsIcon,
  audit: HistoryIcon,
} as const;

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: string };
export type NavGroup = { label: string; items: NavItem[] };

const NAV_CLOSED_KEY = "rm_nav_closed";

export function SidebarNav({
  groups,
  collapsed = false,
  onNavigate,
}: {
  groups: NavGroup[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const isActiveHref = React.useCallback(
    (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href)),
    [pathname],
  );

  // Which group headers the user has collapsed (persisted). A group is always shown open when it
  // contains the current route, so you never lose your place.
  const [closed, setClosed] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(NAV_CLOSED_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration of persisted collapse state
      if (raw) setClosed(new Set(JSON.parse(raw) as string[]));
    } catch { /* ignore */ }
  }, []);
  const toggle = React.useCallback((label: string) => {
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try { localStorage.setItem(NAV_CLOSED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Collapsed icon rail: no group headers, just dividers between groups.
  if (collapsed) {
    return (
      <nav aria-label="Primary" className="flex flex-col gap-3 px-2 py-2">
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <div aria-hidden className="mx-auto my-1 h-px w-6 bg-sidebar-border/70" />
            {group.items.map((item) => (
              <NavLink key={item.href} item={item} active={isActiveHref(item.href)} collapsed onNavigate={onNavigate} />
            ))}
          </div>
        ))}
      </nav>
    );
  }

  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 px-3 py-2">
      {groups.map((group) => {
        const hasActive = group.items.some((i) => isActiveHref(i.href));
        const open = hasActive || !closed.has(group.label);
        return (
          <div key={group.label} className="flex flex-col">
            <button
              type="button"
              onClick={() => toggle(group.label)}
              aria-expanded={open}
              className="group/head flex items-center gap-2 rounded-sm px-2 py-1.5 text-[0.6875rem] font-semibold tracking-[0.12em] text-sidebar-foreground/45 uppercase transition-colors hover:text-sidebar-foreground/70 focus-visible:outline-none"
            >
              <ChevronRightIcon className={cn("size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")} />
              <span>{group.label}</span>
              <span aria-hidden className="h-px flex-1 bg-sidebar-border/70" />
            </button>
            {open && (
              <div className="flex flex-col gap-0.5 pb-1">
                {group.items.map((item) => (
                  <NavLink key={item.href} item={item} active={isActiveHref(item.href)} collapsed={false} onNavigate={onNavigate} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function NavLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = ICONS[item.icon];

  const link = (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      data-active={active || undefined}
      onClick={onNavigate}
      className={cn(
        "group/item relative flex items-center rounded-sm text-sm outline-none transition-colors duration-150 motion-reduce:transition-none",
        "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
        "data-[active]:bg-sidebar-accent data-[active]:font-medium data-[active]:text-sidebar-accent-foreground",
        "focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
        collapsed ? "justify-center px-0 py-2" : "gap-3 px-3 py-2",
      )}
    >
      {/* Brass accent rail — grows in on active; muted ghost-tick on hover. Hidden on the icon rail. */}
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 left-0.5 h-5 w-[3px] -translate-y-1/2 origin-center rounded-full bg-sidebar-primary transition-all duration-200 ease-out motion-reduce:transition-none",
          collapsed
            ? "hidden"
            : active
              ? "scale-y-100 opacity-100"
              : "scale-y-0 opacity-0 group-hover/item:scale-y-50 group-hover/item:opacity-40",
        )}
      />
      <Icon
        className={cn(
          "size-[18px] shrink-0 transition-colors motion-reduce:transition-none",
          "text-sidebar-foreground/55 group-hover/item:text-sidebar-accent-foreground",
          "group-data-[active]/item:text-sidebar-primary",
        )}
      />
      <span className={cn("truncate", collapsed && "sr-only")}>{item.label}</span>
      {item.badge && !collapsed && (
        <span className="ml-auto rounded-full bg-sidebar-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-accent-foreground tabular-nums">
          {item.badge}
        </span>
      )}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right" sideOffset={10}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  );
}
