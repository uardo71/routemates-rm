import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangleIcon, CheckCircle2Icon, GitPullRequestIcon, TicketIcon, UserXIcon, UsersIcon } from "lucide-react";
import { CR_FLOW, CR_STAGES, asCrStage, isChangeRequestType } from "@/lib/change-request";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canManageClientTickets, visibleClientWhere, visibleTicketWhere, STAFF_ONLY } from "@/lib/permissions";
import { loadTicketConfig } from "@/lib/ticket-config.server";
import { isOpenCategory } from "@/lib/ticket-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { serializeTicketRow, customColumnsOf, TICKET_ROW_SELECT } from "../../serialize";
import { TicketsClient, type ClientConfig } from "../../tickets-client";
import { SupportShell } from "../../support-shell";
import { ClientTeamCard } from "../../client-team-card";
import { ClientSwitcher } from "../../client-switcher";
import { normalizeFilters, type TicketFocus } from "../../filters";

const FOCUS = new Set(["open", "breached", "unassigned", "critical", "resolved7d"]);
function parseFocus(v: string | undefined): TicketFocus | null {
  return v && FOCUS.has(v) ? (v as TicketFocus) : null;
}


// One client's support workspace — the Azure DevOps "project" idea: its queue, its numbers and its
// team on one screen, reachable from the overview or the switcher without re-filtering a
// company-wide list. 404s (not 403s) for accounts the user isn't staffed on, so the existence of a
// client relationship isn't leaked.

export default async function ClientWorkspacePage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ focus?: string }> }) {
  const { clientId } = await params;
  const focus = parseFocus((await searchParams).focus);
  const user = await requireUser();

  const client = await prisma.client.findFirst({
    where: { id: clientId, ...(await visibleClientWhere(user)) },
    select: { id: true, name: true },
  });
  if (!client) notFound();

  const cfg = await loadTicketConfig(user.companyId);
  const canManage = await canManageClientTickets(user, client.id);
  const canEditTeam = user.role === "ADMIN";
  const ticketWhere = await visibleTicketWhere(user);

  const [tickets, users, views, switcherClients, team, companyClients] = await Promise.all([
    // Membership scoping AND this client — the OR from visibleTicketWhere is ANDed with clientId.
    prisma.ticket.findMany({ where: { ...ticketWhere, clientId: client.id }, select: TICKET_ROW_SELECT, orderBy: { createdAt: "desc" } }),
    prisma.user.findMany({ where: { companyId: user.companyId }, select: { id: true, name: true } }),
    prisma.ticketView.findMany({
      where: { companyId: user.companyId, OR: [{ ownerId: user.id }, { shared: true }] },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    }),
    prisma.client.findMany({ where: await visibleClientWhere(user), select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.clientTeamMember.findMany({
      where: { clientId: client.id },
      select: { id: true, userId: true, role: true, user: { select: { name: true } } },
      orderBy: [{ role: "asc" }, { user: { name: "asc" } }],
    }),
    // Only to translate views saved with client NAMES into ids (normalizeFilters).
    prisma.client.findMany({ where: { companyId: user.companyId }, select: { id: true, name: true } }),
  ]);
  const candidates = canEditTeam
    ? await prisma.user.findMany({
        where: { companyId: user.companyId, active: true, ...STAFF_ONLY, id: { notIn: team.map((m) => m.userId) } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const userName = (id: string) => nameById.get(id) ?? "—";
  const rows = tickets.map((t) => serializeTicketRow(t, cfg, userName));

  // Headline numbers, from the same rows the table shows so they can never disagree.
  const asOf = new Date();
  const now = asOf.getTime();
  const weekAgo = now - 7 * 86_400_000;
  const open = rows.filter((r) => isOpenCategory(r.statusCategory));
  const unassigned = open.filter((r) => !r.assigneeName).length;
  const breached = open.filter((r) => {
    if (!r.slaApplicable) return false; // a type with no SLA can never be breached
    const target = r.firstResponseAt ? r.resolveBy : r.respondBy;
    return !!target && now > new Date(target).getTime();
  }).length;
  const resolved7d = rows.filter((r) => r.resolvedAt && new Date(r.resolvedAt).getTime() >= weekAgo).length;

  // Change requests carry no SLA — this strip shows where they are instead.
  const crType = cfg.types.find((x) => isChangeRequestType(x.key));
  const crStageOf = new Map((crType?.statuses ?? []).map((s) => [s.id, asCrStage(s.key)]));
  const crOpen = crType ? open.filter((r) => r.typeId === crType.id) : [];
  const crByStage = CR_FLOW.map((k) => ({ key: k, label: CR_STAGES[k].label, count: crOpen.filter((r) => crStageOf.get(r.statusId) === k).length })).filter((s) => s.count > 0);
  const todayUtc = new Date(`${asOf.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const crOverdue = crOpen.length > 0
    ? await prisma.changeRequest.count({ where: { ticketId: { in: crOpen.map((r) => r.id) }, nextStepDue: { lt: todayUtc } } })
    : 0;

  const config: ClientConfig = {
    types: cfg.types.map((t) => ({
      id: t.id, name: t.name, color: t.color, icon: t.icon,
      statuses: t.statuses.map((s) => ({ id: s.id, name: s.name, color: s.color, category: s.category })),
    })),
    ...customColumnsOf(cfg),
  };

  return (
    <SupportShell
      active="clients"
      title={client.name}
      subtitle={`Support workspace · ${team.length === 0 ? "no team assigned" : `${team.length} on the team`}`}
      canManage={canManage}
      newTicketHref={`/tickets/new?clientId=${client.id}`}
      aside={switcherClients.length > 1 ? <ClientSwitcher current={client.id} clients={switcherClients} /> : undefined}
    >

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Link href={`/tickets/c/${client.id}?focus=open`} className="block rounded-lg ring-primary/40 hover:ring-2"><StatCard label="Open" value={open.length} icon={TicketIcon} sublabel={`${rows.length} total · click to list`} /></Link>
        <Link href={`/tickets/c/${client.id}?focus=breached`} className="block rounded-lg ring-primary/40 hover:ring-2"><StatCard label="SLA breached" value={breached} icon={AlertTriangleIcon} tone={breached > 0 ? "destructive" : "default"} sublabel="past respond / resolve target" /></Link>
        <Link href={`/tickets/c/${client.id}?focus=unassigned`} className="block rounded-lg ring-primary/40 hover:ring-2"><StatCard label="Unassigned" value={unassigned} icon={UserXIcon} tone={unassigned > 0 ? "warning" : "default"} sublabel="open, nobody on it" /></Link>
        <Link href={`/tickets/c/${client.id}?focus=resolved7d`} className="block rounded-lg ring-primary/40 hover:ring-2"><StatCard label="Resolved" value={resolved7d} icon={CheckCircle2Icon} sublabel="last 7 days" /></Link>
      </div>

      {crOpen.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-4 py-2.5 text-sm">
          <span className="inline-flex items-center gap-1.5 font-medium"><GitPullRequestIcon className="size-4 text-muted-foreground" /> {crOpen.length} change request{crOpen.length === 1 ? "" : "s"} in flight</span>
          {crByStage.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1 text-muted-foreground">
              {s.label} <span className="rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-foreground">{s.count}</span>
            </span>
          ))}
          {crOverdue > 0 && <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400"><AlertTriangleIcon className="size-3.5" /> {crOverdue} next step{crOverdue === 1 ? "" : "s"} overdue</span>}
          <span className="ml-auto text-xs text-muted-foreground">No SLA — tracked by stage</span>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <TicketsClient
          key={focus ?? "all"}
          initialFocus={focus}
          lockedClient={{ id: client.id, name: client.name }}
          rows={rows}
          config={config}
          canManage={canManage}
          currentUserId={user.id}
          views={views.map((v) => ({
            id: v.id, name: v.name, shared: v.shared, mine: v.ownerId === user.id,
            filters: normalizeFilters(v.filters, users, companyClients),
            columns: Array.isArray(v.columns) ? (v.columns as string[]) : [],
            sort: (v.sort as { key: string; dir: "asc" | "desc" } | null) ?? null,
          }))}
        />
        <aside>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UsersIcon className="size-4 text-muted-foreground" /> Team
                <span className="font-normal text-muted-foreground">({team.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ClientTeamCard
                clientId={client.id}
                members={team.map((m) => ({ id: m.id, userId: m.userId, name: m.user.name, role: m.role }))}
                candidates={candidates}
                canEdit={canEditTeam}
              />
            </CardContent>
          </Card>
        </aside>
      </div>
    </SupportShell>
  );
}
