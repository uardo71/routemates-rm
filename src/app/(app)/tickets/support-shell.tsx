import Link from "next/link";
import { LayoutGridIcon, ListIcon, PlusIcon, SettingsIcon, UsersIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// One chrome for the whole Support module. Before this, every route invented its own action row:
// Configure existed only on All tickets, the view switcher was different on each page, and the
// client workspace had neither. Now the same header, the same switcher and the same actions sit on
// every Support surface, so nothing has to be hunted for.

export type SupportView = "clients" | "all" | "board" | "settings";

const NAV: { key: SupportView; label: string; href: string }[] = [
  { key: "clients", label: "Clients", href: "/tickets" },
  { key: "all", label: "All tickets", href: "/tickets/all" },
  { key: "board", label: "Board", href: "/tickets/board" },
];

export function SupportShell({ active, title, subtitle, canManage, newTicketHref = "/tickets/new", aside, children }: {
  active: SupportView;
  title: string;
  subtitle?: React.ReactNode;
  canManage: boolean;
  /** Pre-fills the client inside a workspace. */
  newTicketHref?: string;
  /** Anything that belongs beside the title on one route only — the workspace's client switcher. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {aside}
          {canManage && (
            <Link
              href="/tickets/settings"
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:border-primary/50 hover:text-primary",
                active === "settings" && "border-primary/50 text-primary",
              )}
            >
              <SettingsIcon className="size-4" /> Configure
            </Link>
          )}
          <Link href={newTicketHref} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:bg-foreground/90">
            <PlusIcon className="size-4" /> New ticket
          </Link>
        </div>
      </div>

      {/* The three ways to look at the same tickets. A workspace counts as Clients — you drilled in from there. */}
      <div className="flex w-fit items-center gap-1 rounded-md border bg-muted/30 p-1">
        {NAV.map((n) => {
          const on = n.key === active;
          return (
            <Link
              key={n.key} href={n.href} aria-current={on ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                on ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              {n.key === "clients" ? <UsersIcon className="size-4" /> : n.key === "all" ? <ListIcon className="size-4" /> : <LayoutGridIcon className="size-4" />}
              {n.label}
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}
