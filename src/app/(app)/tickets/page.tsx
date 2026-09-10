import Link from "next/link";
import { AlertTriangleIcon, CheckCircle2Icon, LayoutGridIcon, ListIcon, PlusIcon, TicketIcon, UserXIcon, UsersIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { visibleClientWhere, visibleTicketWhere } from "@/lib/permissions";
import { isOpenCategory } from "@/lib/ticket-config";
import { StatCard } from "@/components/stat-card";
import { InitialsAvatar } from "@/components/initials-avatar";
import { cn } from "@/lib/utils";

export const metadata = { title: "Support — clients" };

// The Support landing page: one card per client, the way Azure DevOps lists projects. Pick a client
// to enter its workspace instead of filtering a company-wide list every time. Scoped by team
// membership — an admin sees every account, everyone else the accounts they're staffed on.

type ClientStats = { open: number; unassigned: number; breached: number; critical: number; resolved7d: number; lastActivity: Date | null };

function emptyStats(): ClientStats {
  return { open: 0, unassigned: 0, breached: 0, critical: 0, resolved7d: 0, lastActivity: null };
}

function daysAgo(d: Date | null, now: number): string {
  if (!d) return "no activity";
  const days = Math.floor((now - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default async function SupportOverviewPage() {
  const user = await requireUser();
  const asOf = new Date();
  const now = asOf.getTime();
  const weekAgo = new Date(now - 7 * 86_400_000);

  const [clients, tickets] = await Promise.all([
    prisma.client.findMany({
      where: await visibleClientWhere(user),
      select: {
        id: true, name: true,
        teamMembers: { select: { role: true, user: { select: { name: true } } }, orderBy: [{ role: "asc" }, { user: { name: "asc" } }] },
      },
      orderBy: { name: "asc" },
    }),
    prisma.ticket.findMany({
      where: await visibleTicketWhere(user),
      select: {
        clientId: true, assigneeId: true, priority: true, updatedAt: true, resolvedAt: true,
        firstResponseAt: true, respondBy: true, resolveBy: true,
        statusDef: { select: { category: true } },
      },
    }),
  ]);

  const stats = new Map<string, ClientStats>();
  let unfiled = 0; // tickets with no client at all
  for (const t of tickets) {
    const key = t.clientId ?? "";
    if (!key) unfiled++;
    const s = stats.get(key) ?? emptyStats();
    const open = isOpenCategory(t.statusDef.category);
    if (open) {
      s.open++;
      if (!t.assigneeId) s.unassigned++;
      if (t.priority === "CRITICAL") s.critical++;
      // Same rule as the SLA pill: the live target is respond-by until answered, then resolve-by.
      const target = t.firstResponseAt ? t.resolveBy : t.respondBy;
      if (target && now > target.getTime()) s.breached++;
    }
    if (t.resolvedAt && t.resolvedAt >= weekAgo) s.resolved7d++;
    if (!s.lastActivity || t.updatedAt > s.lastActivity) s.lastActivity = t.updatedAt;
    stats.set(key, s);
  }
  const total = [...stats.values()].reduce(
    (a, s) => ({ open: a.open + s.open, unassigned: a.unassigned + s.unassigned, breached: a.breached + s.breached, resolved7d: a.resolved7d + s.resolved7d }),
    { open: 0, unassigned: 0, breached: 0, resolved7d: 0 },
  );

  // Busiest accounts first; quiet ones (no open work) sink to the bottom alphabetically.
  const cards = clients
    .map((c) => ({ ...c, s: stats.get(c.id) ?? emptyStats() }))
    .sort((a, b) => b.s.open - a.s.open || a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Support</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {user.role === "ADMIN" ? "Every client account." : "The client accounts you're staffed on."} Open one to work its queue.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/tickets/all" className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:border-primary/50 hover:text-primary"><ListIcon className="size-4" /> All tickets</Link>
          <Link href="/tickets/board" className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:border-primary/50 hover:text-primary"><LayoutGridIcon className="size-4" /> Board</Link>
          <Link href="/tickets/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:bg-foreground/90"><PlusIcon className="size-4" /> New ticket</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open" value={total.open} icon={TicketIcon} sublabel={`across ${cards.length} client${cards.length === 1 ? "" : "s"}`} />
        <StatCard label="SLA breached" value={total.breached} icon={AlertTriangleIcon} tone={total.breached > 0 ? "destructive" : "default"} sublabel="past respond / resolve target" />
        <StatCard label="Unassigned" value={total.unassigned} icon={UserXIcon} tone={total.unassigned > 0 ? "warning" : "default"} sublabel="open, nobody on it" />
        <StatCard label="Resolved" value={total.resolved7d} icon={CheckCircle2Icon} sublabel="last 7 days" />
      </div>

      {cards.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          You&apos;re not staffed on any client account yet. Ask an admin to add you to a client&apos;s support team.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => {
            const leads = c.teamMembers.filter((m) => m.role === "LEAD").map((m) => m.user.name);
            const others = c.teamMembers.filter((m) => m.role !== "LEAD").map((m) => m.user.name);
            const team = [...leads, ...others];
            const attention = c.s.breached > 0 || c.s.critical > 0;
            return (
              <Link
                key={c.id}
                href={`/tickets/c/${c.id}`}
                className={cn(
                  "group flex flex-col gap-4 rounded-lg border bg-card p-4 transition-colors hover:border-primary/50",
                  attention && "border-rose-500/40",
                )}
              >
                <div className="flex items-center gap-3">
                  <InitialsAvatar name={c.name} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold group-hover:text-primary">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{daysAgo(c.s.lastActivity, now)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-2xl font-semibold tabular-nums">{c.s.open}</div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">open</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className={cn("inline-flex items-center gap-1", c.s.breached > 0 ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground/60")}>
                    <AlertTriangleIcon className="size-3" /> {c.s.breached} breached
                  </span>
                  <span className={cn("inline-flex items-center gap-1", c.s.unassigned > 0 ? "font-medium text-amber-600" : "text-muted-foreground/60")}>
                    <UserXIcon className="size-3" /> {c.s.unassigned} unassigned
                  </span>
                  {c.s.critical > 0 && <span className="font-medium text-rose-600 dark:text-rose-400">{c.s.critical} critical</span>}
                  <span className="text-muted-foreground/60">{c.s.resolved7d} resolved this week</span>
                </div>

                <div className="flex items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
                  <UsersIcon className="size-3.5 shrink-0" />
                  {team.length === 0 ? (
                    <span className="italic">no team yet</span>
                  ) : (
                    <span className="truncate">
                      {team.slice(0, 3).join(", ")}{team.length > 3 && ` +${team.length - 3}`}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {unfiled > 0 && (
        <p className="text-xs text-muted-foreground">
          {unfiled} ticket{unfiled === 1 ? " isn't" : "s aren't"} filed under any client — find {unfiled === 1 ? "it" : "them"} in{" "}
          <Link href="/tickets/all" className="text-primary hover:underline">All tickets</Link>.
        </p>
      )}
    </div>
  );
}
