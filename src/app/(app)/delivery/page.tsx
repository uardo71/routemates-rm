import Link from "next/link";
import { format } from "date-fns";
import { LayoutDashboardIcon, TriangleAlertIcon, ClipboardListIcon, SendIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/stat-card";
import { InitialsAvatar } from "@/components/initials-avatar";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { RAG_DOT, RAG_LABEL, RAG_PILL } from "@/lib/delivery";
import type { RagStatus } from "@prisma/client";

const UAT_LABEL: Record<string, string> = { NOT_STARTED: "Not started", SENT: "Sent", ACCEPTED: "Accepted", CHANGES_REQUESTED: "Changes req." };
const todayUtc = () => new Date(new Date().toISOString().slice(0, 10));

export default async function DeliveryPage() {
  const user = await requirePermission("delivery:manage");
  // A PM sees the projects they manage; an admin sees all.
  const where = user.role === "ADMIN" ? { companyId: user.companyId } : { companyId: user.companyId, managerId: user.id };

  const projects = await prisma.project.findMany({
    where,
    include: {
      client: { select: { name: true } },
      manager: { select: { name: true } },
      parent: { select: { name: true } },
      milestones: { select: { _count: { select: { assignments: true } } } },
      checklistItems: { select: { done: true, dueDate: true } },
      statusReports: { orderBy: { reportDate: "desc" }, take: 1, select: { reportDate: true, overallRag: true, sentAt: true } },
      raidItems: { where: { status: { not: "CLOSED" }, type: { in: ["RISK", "ISSUE"] } }, select: { id: true } },
    },
    orderBy: [{ name: "asc" }],
  });

  const today = todayUtc();
  const rows = projects.map((p) => {
    const team = p.milestones.reduce((s, m) => s + m._count.assignments, 0);
    const total = p.checklistItems.length;
    const done = p.checklistItems.filter((c) => c.done).length;
    const overdue = p.checklistItems.filter((c) => !c.done && c.dueDate != null && c.dueDate < today).length;
    const last = p.statusReports[0] ?? null;
    const openRaid = p.raidItems.length;

    let health: RagStatus = "GREEN";
    if (last?.overallRag === "RED" || overdue > 0) health = "RED";
    else if (last?.overallRag === "AMBER") health = "AMBER";
    else if (!last && p.status === "ACTIVE") health = "AMBER"; // active but never reported

    return {
      id: p.id, name: p.name, number: p.number, clientName: p.client.name, status: p.status,
      parentProjectId: p.parentProjectId, endCustomer: p.endCustomer,
      started: p.status !== "PLANNED", team, done, total, overdue, last, openRaid, uatStatus: p.uatStatus, health,
    };
  });

  // Order so each program is followed by its sub-projects (end-customer streams).
  const orderedRows: typeof rows = [];
  const seen = new Set<string>();
  for (const r of rows.filter((r) => !r.parentProjectId)) {
    orderedRows.push(r); seen.add(r.id);
    for (const c of rows.filter((c) => c.parentProjectId === r.id)) { orderedRows.push(c); seen.add(c.id); }
  }
  for (const r of rows) if (!seen.has(r.id)) orderedRows.push(r); // orphans (parent not in view)

  const needAttention = rows.filter((r) => r.health !== "GREEN").length;
  const noRecentStatus = rows.filter((r) => r.status === "ACTIVE" && !r.last).length;
  const overdueTasks = rows.reduce((s, r) => s + r.overdue, 0);
  const openRaidTotal = rows.reduce((s, r) => s + r.openRaid, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><LayoutDashboardIcon className="size-6 text-muted-foreground" /> Delivery cockpit</h1>
        <p className="text-sm text-muted-foreground">Governance at a glance — health, resourcing, checklists, status reports and RAID across your projects.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Needs attention" value={needAttention} icon={TriangleAlertIcon} tone={needAttention > 0 ? "warning" : "default"} sublabel={`of ${rows.length} projects`} />
        <StatCard label="No status yet" value={noRecentStatus} icon={SendIcon} tone={noRecentStatus > 0 ? "warning" : "default"} sublabel="active, never reported" />
        <StatCard label="Overdue tasks" value={overdueTasks} icon={ClipboardListIcon} tone={overdueTasks > 0 ? "destructive" : "default"} sublabel="across checklists" />
        <StatCard label="Open risks/issues" value={openRaidTotal} icon={TriangleAlertIcon} sublabel="RAID" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Projects</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Health</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Checklist</TableHead>
                  <TableHead>Last status</TableHead>
                  <TableHead>Open RAID</TableHead>
                  <TableHead>UAT</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderedRows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40">
                    <TableCell>
                      <Link href={`/delivery/${r.id}`} className="inline-flex items-center gap-2">
                        <span className={cn("size-2.5 rounded-full", RAG_DOT[r.health])} />
                        <span className="sr-only">{RAG_LABEL[r.health]}</span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/delivery/${r.id}`} className={cn("flex items-center gap-2.5", r.parentProjectId && "pl-6 border-l-2 border-muted ml-1")}>
                        <InitialsAvatar name={r.endCustomer ?? r.clientName} className="size-7 text-[10px]" />
                        <span>
                          <span className="block font-medium hover:underline">
                            {r.name}
                            {r.endCustomer && <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{r.endCustomer}</span>}
                          </span>
                          <span className="block text-xs text-muted-foreground">{r.number ? <span className="font-mono">{r.number}</span> : null}{r.number ? " · " : ""}{r.clientName}</span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>{r.started ? <Badge variant="outline">Started</Badge> : <Badge variant="secondary">Planned</Badge>}</TableCell>
                    <TableCell className={cn("tabular-nums", r.team === 0 && "text-amber-600")}>{r.team || "—"}</TableCell>
                    <TableCell>
                      <span className="text-sm tabular-nums">{r.done}/{r.total}</span>
                      {r.overdue > 0 && <span className="ml-1.5 text-xs text-destructive">· {r.overdue} overdue</span>}
                    </TableCell>
                    <TableCell>
                      {r.last ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className={cn("size-2 rounded-full", RAG_DOT[r.last.overallRag])} />
                          <span className="text-sm text-muted-foreground">{format(r.last.reportDate, "MMM d")}</span>
                          {!r.last.sentAt && <Badge variant="secondary" className="text-[10px]">draft</Badge>}
                        </span>
                      ) : (
                        <span className="text-sm text-amber-600">none</span>
                      )}
                    </TableCell>
                    <TableCell className={cn("tabular-nums", r.openRaid > 0 && "text-amber-600")}>{r.openRaid || "—"}</TableCell>
                    <TableCell><span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", r.uatStatus === "ACCEPTED" ? RAG_PILL.GREEN : "bg-muted text-muted-foreground")}>{UAT_LABEL[r.uatStatus] ?? r.uatStatus}</span></TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No projects assigned to you yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
