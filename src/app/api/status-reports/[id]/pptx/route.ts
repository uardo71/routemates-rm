import pptxgen from "pptxgenjs";
import { NextResponse } from "next/server";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can, canManageProject } from "@/lib/permissions";
import { SEVERITY_LABEL } from "@/lib/delivery";
import type { RagStatus } from "@prisma/client";

const fmt = (d: Date | null) => (d ? format(d, "dd/MM/yyyy") : "—");
const INK = "141F2B";
const MUTE = "6B7280";
const SEV_HEX: Record<RagStatus, string> = { GREEN: "16A34A", AMBER: "D97706", RED: "DC2626" };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "delivery:manage")) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const report = await prisma.statusReport.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      author: { select: { name: true } },
      actions: { orderBy: { sortOrder: "asc" } },
      engagement: { select: { name: true } },
      project: {
        select: {
          id: true, name: true, number: true,
          client: { select: { name: true } },
          manager: { select: { name: true } },
          milestones: { select: { name: true, status: true }, orderBy: { createdAt: "asc" } },
          planTasks: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });
  if (!report) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!(await canManageProject(user, report.project.id))) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  // Plan/RAID scoped to the report's engagement (or project-level when null).
  const p = { ...report.project, planTasks: report.project.planTasks.filter((t) => (t.engagementId ?? null) === (report.engagementId ?? null)) };
  const endCustomer = report.engagement?.name ?? p.client.name;
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5

  // Slide 1 — Title
  const s1 = pptx.addSlide();
  s1.addShape("rect", { x: 0, y: 0, w: "100%", h: 1.1, fill: { color: INK } });
  s1.addText(endCustomer, { x: 0.6, y: 0.28, w: 12, fontSize: 16, color: "FFFFFF", bold: true });
  s1.addText(`PM ${p.manager?.name ?? report.author.name}`, { x: 0.6, y: 0.62, w: 12, fontSize: 12, color: "C9D1D9" });
  s1.addText("Status Update", { x: 0.6, y: 2.7, w: 12, fontSize: 34, bold: true, color: INK });
  s1.addText(p.name, { x: 0.6, y: 3.6, w: 12, fontSize: 22, color: MUTE });
  s1.addText(`${fmt(report.reportDate)}${p.number ? ` · ${p.number}` : ""}`, { x: 0.6, y: 4.4, w: 12, fontSize: 14, color: MUTE });

  // Slide 2 — Agenda
  const s2 = pptx.addSlide();
  s2.addText("Agenda", { x: 0.6, y: 0.4, fontSize: 26, bold: true, color: INK });
  s2.addText(
    [{ text: "Project Status" }, { text: "Project Plan" }, { text: "Scope" }, { text: "Q&A" }].map((t) => ({ text: t.text, options: { bullet: true, fontSize: 18, color: INK, paraSpaceAfter: 12 } })),
    { x: 0.9, y: 1.4, w: 11, h: 4 },
  );

  // Slide 3 — Project Status
  const s3 = pptx.addSlide();
  s3.addText("Project Status", { x: 0.6, y: 0.4, fontSize: 26, bold: true, color: INK });
  // Meta line: Type / Status / Severity
  s3.addText(
    [
      { text: "Type: ", options: { bold: true, color: MUTE } }, { text: "Project    ", options: { color: INK } },
      { text: "Status: ", options: { bold: true, color: MUTE } }, { text: report.progressPercent != null ? `Progress (${report.progressPercent}%)    ` : "In progress    ", options: { color: INK } },
      { text: "Severity/Timing: ", options: { bold: true, color: MUTE } },
    ],
    { x: 0.6, y: 1.15, w: 12, fontSize: 12 },
  );
  s3.addText(SEVERITY_LABEL[report.overallRag], { x: 0.6, y: 1.45, w: 3.2, h: 0.4, fontSize: 12, bold: true, color: "FFFFFF", align: "center", valign: "middle", fill: { color: SEV_HEX[report.overallRag] } });

  s3.addText("Current Status", { x: 0.6, y: 2.05, fontSize: 13, bold: true, color: INK });
  s3.addText(report.summary || "—", { x: 0.6, y: 2.4, w: 7.4, h: 4.4, fontSize: 11, color: INK, valign: "top" });

  s3.addText("Next Actions", { x: 8.3, y: 2.05, fontSize: 13, bold: true, color: INK });
  const actionRuns = report.actions.length
    ? report.actions.map((a) => ({
        text: `${a.description}${a.owner ? ` — ${a.owner}` : ""}${a.dueDate ? ` (by ${fmt(a.dueDate)})` : ""}${a.critical ? "  [Critical]" : ""}`,
        options: { bullet: true, fontSize: 11, color: a.critical ? SEV_HEX.RED : INK, paraSpaceAfter: 8 },
      }))
    : [{ text: "Nothing to report", options: { fontSize: 11, color: MUTE } }];
  s3.addText(actionRuns, { x: 8.3, y: 2.4, w: 4.4, h: 2.6, valign: "top" });

  s3.addText("Corrective Actions", { x: 8.3, y: 5.2, fontSize: 13, bold: true, color: INK });
  s3.addText(report.correctiveActions || "Nothing to report", { x: 8.3, y: 5.55, w: 4.4, h: 1.2, fontSize: 11, color: INK, valign: "top" });

  // Legend
  const legend: [string, RagStatus][] = [["Low / On time", "GREEN"], ["Medium / Delay", "AMBER"], ["High / Business impact", "RED"]];
  legend.forEach(([label, rag], i) => {
    s3.addShape("rect", { x: 0.6 + i * 2.7, y: 7.0, w: 0.2, h: 0.2, fill: { color: SEV_HEX[rag] } });
    s3.addText(label, { x: 0.85 + i * 2.7, y: 6.93, w: 2.5, fontSize: 9, color: MUTE });
  });

  // Slide 4 — Project Plan (real plan table when present, else milestones)
  const s4 = pptx.addSlide();
  s4.addText("Project Plan", { x: 0.6, y: 0.4, fontSize: 26, bold: true, color: INK });
  const PLAN_STATUS: Record<string, string> = { NOT_STARTED: "Not started", IN_PROGRESS: "In progress", COMPLETED: "Completed", BLOCKED: "Blocked" };
  if (p.planTasks.length > 0) {
    const header = ["Phase", "Task", "Owner", "Start", "Due", "%", "Status"].map((t) => ({ text: t, options: { bold: true, color: "FFFFFF", fill: { color: INK }, fontSize: 9 } }));
    const rows = p.planTasks.map((t) => [
      { text: t.phase ?? "", options: { fontSize: 8, color: MUTE } },
      { text: `${t.isMilestone ? "◆ " : ""}${t.name}`, options: { fontSize: 8, bold: t.isMilestone, color: INK } },
      { text: t.owner ?? "", options: { fontSize: 8, color: INK } },
      { text: fmt(t.startDate), options: { fontSize: 8, color: INK } },
      { text: fmt(t.dueDate), options: { fontSize: 8, color: INK } },
      { text: t.isMilestone ? "" : `${t.progress}%`, options: { fontSize: 8, color: INK } },
      { text: PLAN_STATUS[t.status] ?? t.status, options: { fontSize: 8, color: INK } },
    ]);
    s4.addTable([header, ...rows], { x: 0.5, y: 1.2, w: 12.3, colW: [2.0, 3.9, 1.9, 1.3, 1.3, 0.6, 1.3], border: { type: "solid", color: "E5E7EB", pt: 0.5 }, valign: "middle", autoPage: true });
  } else {
    if (report.milestoneNotes) s4.addText(report.milestoneNotes, { x: 0.6, y: 1.2, w: 12, h: 1.4, fontSize: 12, color: INK, valign: "top" });
    const mRuns = p.milestones.length
      ? p.milestones.map((m) => ({ text: `${m.name} — ${m.status}`, options: { bullet: true, fontSize: 13, color: INK, paraSpaceAfter: 8 } }))
      : [{ text: "No plan defined yet.", options: { fontSize: 12, color: MUTE } }];
    s4.addText(mRuns, { x: 0.9, y: report.milestoneNotes ? 2.8 : 1.4, w: 11, h: 4 });
  }

  // Slide 5 — Q&A
  const s5 = pptx.addSlide();
  s5.addText("Q&A", { x: 0.6, y: 3.2, fontSize: 40, bold: true, color: INK });

  const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const safe = (p.number ?? p.name).replace(/[^\w-]+/g, "_").slice(0, 40);
  const fileName = `${endCustomer.replace(/[^\w-]+/g, "_")}-Status-${safe}-${format(report.reportDate, "yyyy-MM-dd")}.pptx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
