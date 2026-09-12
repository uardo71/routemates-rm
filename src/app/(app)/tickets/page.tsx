import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { visibleClientWhere, visibleTicketWhere } from "@/lib/permissions";
import { isOpenCategory } from "@/lib/ticket-config";
import { summarize, type ClientRow } from "@/lib/support-overview";
import { SupportShell } from "./support-shell";
import { SupportKpis } from "./support-kpis";
import { ClientsTable } from "./clients-table";

export const metadata = { title: "Support — clients" };

// The Support landing page: every client account as one row of a triage table, worst first. It was
// a card grid, which stopped working somewhere around two dozen accounts — the same thing that
// happened to /portfolio, fixed the same way. Counting lives here; ranking, filtering and the
// "needs attention" rule live in the pure lib so the tiles and the table cannot disagree.

type Acc = {
  open: number; unassigned: number; breached: number; critical: number; resolved7d: number;
  lastActivity: Date | null; oldestOpen: Date | null;
};
const empty = (): Acc => ({ open: 0, unassigned: 0, breached: 0, critical: 0, resolved7d: 0, lastActivity: null, oldestOpen: null });

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
        clientId: true, assigneeId: true, priority: true, updatedAt: true, resolvedAt: true, createdAt: true,
        firstResponseAt: true, respondBy: true, resolveBy: true,
        statusDef: { select: { category: true } },
        typeDef: { select: { slaApplicable: true } },
      },
    }),
  ]);

  const acc = new Map<string, Acc>();
  let unfiled = 0; // tickets with no client at all
  for (const t of tickets) {
    const key = t.clientId ?? "";
    if (!key) unfiled++;
    const s = acc.get(key) ?? empty();
    if (isOpenCategory(t.statusDef.category)) {
      s.open++;
      if (!t.assigneeId) s.unassigned++;
      if (t.priority === "CRITICAL") s.critical++;
      // Same rule as the SLA badge: respond-by until answered, then resolve-by. A type with no SLA
      // never counts as breached.
      const target = t.firstResponseAt ? t.resolveBy : t.respondBy;
      if (t.typeDef.slaApplicable && target && now > target.getTime()) s.breached++;
      if (!s.oldestOpen || t.createdAt < s.oldestOpen) s.oldestOpen = t.createdAt;
    }
    if (t.resolvedAt && t.resolvedAt >= weekAgo) s.resolved7d++;
    if (!s.lastActivity || t.updatedAt > s.lastActivity) s.lastActivity = t.updatedAt;
    acc.set(key, s);
  }

  const rows: ClientRow[] = clients.map((c) => {
    const s = acc.get(c.id) ?? empty();
    const leads = c.teamMembers.filter((m) => m.role === "LEAD");
    return {
      id: c.id, name: c.name,
      open: s.open, unassigned: s.unassigned, breached: s.breached, critical: s.critical, resolved7d: s.resolved7d,
      oldestOpenDays: s.oldestOpen ? Math.floor((now - s.oldestOpen.getTime()) / 86_400_000) : null,
      lastActivity: s.lastActivity ? s.lastActivity.toISOString() : "",
      team: [...leads.map((m) => m.user.name), ...c.teamMembers.filter((m) => m.role !== "LEAD").map((m) => m.user.name)],
      leadCount: leads.length,
    };
  });
  const total = summarize(rows);

  return (
    <SupportShell
      active="clients"
      title="Support"
      subtitle={`${user.role === "ADMIN" ? "Every client account" : "The client accounts you're staffed on"} — worst first. Open one to work its queue.`}
      canManage={can(user, "tickets:manage")}
    >
      <SupportKpis
        items={[
          { key: "open", label: "Open", value: total.open, href: "/tickets/all?focus=open", sublabel: `across ${rows.length} client${rows.length === 1 ? "" : "s"} · click to list` },
          { key: "breached", label: "SLA breached", value: total.breached, href: "/tickets/all?focus=breached", sublabel: "past respond / resolve target", tone: total.breached > 0 ? "destructive" : "default" },
          { key: "unassigned", label: "Unassigned", value: total.unassigned, href: "/tickets/all?focus=unassigned", sublabel: "open, nobody on it", tone: total.unassigned > 0 ? "warning" : "default" },
          { key: "resolved", label: "Resolved", value: total.resolved7d, href: "/tickets/all?focus=resolved7d", sublabel: "last 7 days" },
        ]}
      />

      <ClientsTable rows={rows} nowMs={now} />

      {unfiled > 0 && (
        <p className="text-xs text-muted-foreground">
          {unfiled} ticket{unfiled === 1 ? " isn't" : "s aren't"} filed under any client — find {unfiled === 1 ? "it" : "them"} in{" "}
          <Link href="/tickets/all" className="text-primary hover:underline">All tickets</Link>.
        </p>
      )}
    </SupportShell>
  );
}
