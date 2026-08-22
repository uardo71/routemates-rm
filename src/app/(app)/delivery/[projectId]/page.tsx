import Link from "next/link";
import { notFound } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InitialsAvatar } from "@/components/initials-avatar";
import { LinkButton } from "@/components/link-button";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { canManageProject } from "@/lib/permissions";
import { StatusReportsClient, type ReportRow } from "./status-reports-client";
import { ChecklistClient, type ChecklistRow } from "./checklist-client";
import { RaidClient, type RaidRow } from "./raid-client";
import { MinutesClient, type MinutesRow } from "./minutes-client";
import { DocumentsLibraryClient, type LibraryDoc } from "./documents-client";
import { PlanClient, type PlanRow } from "./plan-client";
import { EngagementBar } from "./engagement-bar";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export default async function DeliveryProjectPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ eng?: string }> }) {
  const { projectId } = await params;
  const { eng } = await searchParams;
  const user = await requirePermission("delivery:manage");
  if (!(await canManageProject(user, projectId))) notFound();

  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId: user.companyId },
    include: {
      client: { select: { name: true } },
      manager: { select: { name: true } },
      engagements: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true } },
      checklistItems: { orderBy: { sortOrder: "asc" } },
      statusReports: { orderBy: { reportDate: "desc" }, include: { author: { select: { name: true } }, actions: { orderBy: { sortOrder: "asc" } } } },
      raidItems: { orderBy: [{ status: "asc" }, { createdAt: "desc" }], include: { createdBy: { select: { name: true } } } },
      meetings: { orderBy: { date: "desc" }, include: { createdBy: { select: { name: true } }, actions: { orderBy: { sortOrder: "asc" } } } },
      documents: { orderBy: { uploadedAt: "desc" }, include: { uploadedBy: { select: { name: true } } } },
      planTasks: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!project) notFound();

  // Selected engagement (null = "Overall", i.e. project-level governance).
  const selectedEng = project.engagements.some((e) => e.id === eng) ? (eng as string) : null;
  const inEng = <T extends { engagementId: string | null }>(x: T) => (x.engagementId ?? null) === selectedEng;

  // Checklist is project-level (the delivery playbook applies to the whole project).
  const checklist: ChecklistRow[] = project.checklistItems.map((c) => ({
    id: c.id, phase: c.phase, title: c.title, done: c.done, dueDate: iso(c.dueDate), completedByName: null, completedAt: iso(c.completedAt),
  }));

  const reports: ReportRow[] = project.statusReports.filter(inEng).map((r) => ({
    id: r.id, reportDate: iso(r.reportDate)!, periodStart: iso(r.periodStart), periodEnd: iso(r.periodEnd),
    cadence: r.cadence, overallRag: r.overallRag, progressPercent: r.progressPercent,
    summary: r.summary, correctiveActions: r.correctiveActions, milestoneNotes: r.milestoneNotes,
    actions: r.actions.map((a) => ({ description: a.description, owner: a.owner, dueDate: iso(a.dueDate), critical: a.critical })),
    sentAt: iso(r.sentAt), authorName: r.author.name,
  }));

  const raid: RaidRow[] = project.raidItems.filter(inEng).map((r) => ({
    id: r.id, type: r.type, title: r.title, description: r.description, severity: r.severity, status: r.status,
    owner: r.owner, dueDate: iso(r.dueDate), response: r.response,
  }));

  const minutes: MinutesRow[] = project.meetings.filter(inEng).map((m) => ({
    id: m.id, date: iso(m.date)!, title: m.title, attendees: m.attendees, notes: m.notes, createdByName: m.createdBy.name,
    actions: m.actions.map((a) => ({ description: a.description, owner: a.owner, dueDate: iso(a.dueDate), done: a.done })),
  }));
  const docs: LibraryDoc[] = project.documents.filter(inEng).map((d) => ({
    id: d.id, kind: d.kind, fileName: d.fileName, originalName: d.originalName, uploadedAt: iso(d.uploadedAt)!, uploadedByName: d.uploadedBy.name,
  }));
  const plan: PlanRow[] = project.planTasks.filter(inEng).map((t) => ({
    id: t.id, phase: t.phase, name: t.name, owner: t.owner, startDate: iso(t.startDate), dueDate: iso(t.dueDate), progress: t.progress, status: t.status, isMilestone: t.isMilestone,
  }));

  const openRaid = raid.filter((r) => r.status !== "CLOSED").length;
  const doneCount = checklist.filter((c) => c.done).length;
  const engName = project.engagements.find((e) => e.id === selectedEng)?.name ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/delivery" className="text-sm text-muted-foreground hover:underline">← Delivery cockpit</Link>
        <div className="mt-1 flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <InitialsAvatar name={project.client.name} className="size-11 text-sm" />
            <div>
              <h1 className="text-2xl font-semibold">{project.name}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {project.number && <span className="font-mono text-foreground">{project.number}</span>}
                {project.number && " · "}
                {project.client.name} · PM {project.manager?.name ?? "—"}
              </p>
            </div>
          </div>
          <LinkButton href={`/projects/${project.id}`} variant="outline" size="sm">Open project</LinkButton>
        </div>
      </div>

      <EngagementBar projectId={project.id} engagements={project.engagements} selectedId={selectedEng} />

      {engName && <p className="-mt-2 text-sm text-muted-foreground">Showing <span className="font-medium text-foreground">{engName}</span> — status reports, plan, RAID, minutes and documents for this engagement.</p>}

      <Tabs defaultValue="status">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="status">Status reports ({reports.length})</TabsTrigger>
          <TabsTrigger value="plan">Plan ({plan.length})</TabsTrigger>
          <TabsTrigger value="checklist">Checklist ({doneCount}/{checklist.length})</TabsTrigger>
          <TabsTrigger value="raid">RAID ({openRaid} open)</TabsTrigger>
          <TabsTrigger value="minutes">Minutes ({minutes.length})</TabsTrigger>
          <TabsTrigger value="documents">Documents ({docs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="status" className="pt-4">
          <StatusReportsClient projectId={project.id} engagementId={selectedEng} reports={reports} />
        </TabsContent>
        <TabsContent value="plan" className="pt-4">
          <PlanClient projectId={project.id} engagementId={selectedEng} tasks={plan} />
        </TabsContent>
        <TabsContent value="checklist" className="pt-4">
          <ChecklistClient projectId={project.id} items={checklist} />
        </TabsContent>
        <TabsContent value="raid" className="pt-4">
          <RaidClient projectId={project.id} engagementId={selectedEng} items={raid} />
        </TabsContent>
        <TabsContent value="minutes" className="pt-4">
          <MinutesClient projectId={project.id} engagementId={selectedEng} items={minutes} />
        </TabsContent>
        <TabsContent value="documents" className="pt-4">
          <DocumentsLibraryClient projectId={project.id} engagementId={selectedEng} docs={docs} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
