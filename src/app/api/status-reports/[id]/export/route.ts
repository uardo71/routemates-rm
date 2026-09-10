import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { approvedHoursForPeriod } from "@/lib/realization-data";
import { requireUser } from "@/lib/session";
import { can, canManageProject } from "@/lib/permissions";
import { SEVERITY_LABEL, RAG_HEX, RAID_TYPE_LABEL, RAID_STATUS_LABEL, RAID_SEVERITY_LABEL, CADENCE_LABEL } from "@/lib/delivery";

const fmt = (d: Date | null) => (d ? format(d, "MMM d, yyyy") : "—");
const INK = "FF141F2B";
const BRASS = "FFA9812F";
const MUTE = "FF6B7280";
const LINE = "FFD9DEE2";
const thin = { style: "thin" as const, color: { argb: LINE } };
const cellBorder = { top: thin, left: thin, bottom: thin, right: thin };

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
          id: true, name: true, number: true, client: { select: { name: true } },
          raidItems: { where: { status: { not: "CLOSED" }, type: { in: ["RISK", "ISSUE", "DEPENDENCY", "DECISION"] } }, orderBy: [{ type: "asc" }, { createdAt: "desc" }] },
        },
      },
    },
  });
  if (!report) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!(await canManageProject(user, report.project.id))) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const p = { ...report.project, raidItems: report.project.raidItems.filter((r) => (r.engagementId ?? null) === (report.engagementId ?? null)) };
  const endCustomerLabel = report.engagement?.name ?? p.client.name;
  const wb = new ExcelJS.Workbook();
  wb.creator = "RM Ops";
  const ws = wb.addWorksheet("Status Update", { properties: { tabColor: { argb: BRASS } }, pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } } });
  ws.columns = [{ width: 30 }, { width: 30 }, { width: 18 }, { width: 16 }];
  let row = 1;

  // Title band
  ws.mergeCells(`A${row}:D${row}`);
  const t = ws.getCell(`A${row}`);
  t.value = `${p.name} — Status Update`;
  t.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
  t.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(row).height = 30;
  row++;
  ws.mergeCells(`A${row}:D${row}`);
  const sub = ws.getCell(`A${row}`);
  sub.value = `${endCustomerLabel}${p.number ? ` · ${p.number}` : ""}`;
  sub.font = { color: { argb: "FFC9D1D9" }, size: 11 };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
  sub.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(row).height = 20;
  row += 2;

  const hours = report.periodStart && report.periodEnd ? await approvedHoursForPeriod(user.companyId, p.id, report.periodStart, report.periodEnd) : null;
  const meta: [string, string][] = [
    ["Report date", fmt(report.reportDate)],
    ["Cadence", report.cadence ? (CADENCE_LABEL[report.cadence] ?? report.cadence) : "—"],
    ["Period", report.periodStart || report.periodEnd ? `${fmt(report.periodStart)} – ${fmt(report.periodEnd)}` : "—"],
    ["Progress", report.progressPercent != null ? `${report.progressPercent}%` : "—"],
    ["Severity / Timing", SEVERITY_LABEL[report.overallRag]],
    ["Prepared by", report.author.name],
    ...(hours ? ([
      ["Approved hours this period", `${hours.periodHours}h${hours.byPerson.length ? ` — ${hours.byPerson.map((x) => `${x.name} ${x.hours}h`).join(", ")}` : ""}`],
      ["Approved hours to date", `${hours.cumulativeHours}h${hours.budgetHours != null ? ` of ${hours.budgetHours}h budget (${hours.budgetHours > 0 ? Math.round((hours.cumulativeHours / hours.budgetHours) * 100) : 0}%)` : ""}`],
    ] as [string, string][]) : []),
  ];
  for (const [k, v] of meta) {
    ws.getCell(`A${row}`).value = k;
    ws.getCell(`A${row}`).font = { bold: true, color: { argb: MUTE }, size: 10 };
    ws.mergeCells(`B${row}:D${row}`);
    const c = ws.getCell(`B${row}`);
    c.value = v;
    if (k === "Severity / Timing") {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RAG_HEX[report.overallRag] } };
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    }
    row++;
  }
  row++;

  const section = (heading: string, body: string | null) => {
    if (!body) return;
    ws.getCell(`A${row}`).value = heading;
    ws.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: INK } };
    row++;
    ws.mergeCells(`A${row}:D${row}`);
    const c = ws.getCell(`A${row}`);
    c.value = body;
    c.alignment = { wrapText: true, vertical: "top" };
    ws.getRow(row).height = Math.min(180, 16 + Math.ceil(body.length / 90) * 15);
    row += 2;
  };

  section("Current status", report.summary);
  section("Accomplishments", report.accomplishments);

  // Next actions table
  if (report.actions.length > 0) {
    ws.getCell(`A${row}`).value = "Next actions";
    ws.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: INK } };
    row++;
    ["Action", "Owner", "Due", "Critical"].forEach((h, i) => {
      const c = ws.getCell(row, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
      c.border = cellBorder;
    });
    row++;
    for (const a of report.actions) {
      ws.getCell(row, 1).value = a.description;
      ws.getCell(row, 1).alignment = { wrapText: true, vertical: "top" };
      ws.getCell(row, 2).value = a.owner ?? "—";
      ws.getCell(row, 3).value = fmt(a.dueDate);
      ws.getCell(row, 4).value = a.critical ? "Critical" : "";
      if (a.critical) ws.getCell(row, 4).font = { bold: true, color: { argb: RAG_HEX.RED } };
      for (let ci = 1; ci <= 4; ci++) ws.getCell(row, ci).border = cellBorder;
      row++;
    }
    row++;
  }

  section("Corrective actions", report.correctiveActions);
  section("Decisions needed", report.decisionsNeeded);
  section("Plan / milestones", report.milestoneNotes);

  const raid = p.raidItems;
  if (raid.length > 0) {
    ws.getCell(`A${row}`).value = "Open RAID items";
    ws.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: INK } };
    row++;
    ["Type", "Title", "Severity", "Status"].forEach((h, i) => {
      const c = ws.getCell(row, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
      c.border = cellBorder;
    });
    row++;
    for (const it of raid) {
      ws.getCell(row, 1).value = RAID_TYPE_LABEL[it.type];
      ws.getCell(row, 2).value = it.title;
      ws.getCell(row, 3).value = it.severity ? RAID_SEVERITY_LABEL[it.severity] : "—";
      ws.getCell(row, 4).value = RAID_STATUS_LABEL[it.status];
      for (let ci = 1; ci <= 4; ci++) ws.getCell(row, ci).border = cellBorder;
      row++;
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const safe = (p.number ?? p.name).replace(/[^\w-]+/g, "_").slice(0, 40);
  const fileName = `Status-${safe}-${format(report.reportDate, "yyyy-MM-dd")}.xlsx`;
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
