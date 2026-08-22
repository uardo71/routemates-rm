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
  ListChecksIcon,
  SettingsIcon,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const ICONS = {
  dashboard: LayoutDashboardIcon,
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
  playbook: ListChecksIcon,
  myPlanning: CalendarDaysIcon,
  opportunities: TargetIcon,
  revenue: TrendingUpIcon,
  budgets: PiggyBankIcon,
  settings: SettingsIcon,
} as const;

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: string };
export type NavGroup = { label: string; items: NavItem[] };

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

  return (
    <nav aria-label="Primary" className={cn("flex flex-col gap-5 py-2", collapsed ? "px-2" : "px-3")}>
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          {collapsed ? (
            <div aria-hidden className="mx-auto my-1 h-px w-6 bg-sidebar-border/70" />
          ) : (
            <div className="flex items-center gap-2 px-2 pb-1">
              <span className="text-[0.6875rem] font-semibold tracking-[0.14em] text-sidebar-foreground/45 uppercase">
                {group.label}
              </span>
              <span aria-hidden className="h-px flex-1 bg-sidebar-border/70" />
            </div>
          )}
          {group.items.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return <NavLink key={item.href} item={item} active={active} collapsed={collapsed} onNavigate={onNavigate} />;
          })}
        </div>
      ))}
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
