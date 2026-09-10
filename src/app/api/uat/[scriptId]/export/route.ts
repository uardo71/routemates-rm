import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canAccessProjectDelivery } from "@/lib/permissions";
import { UAT_RESULT_LABEL, UAT_RESULT_HEX, UAT_ISSUE_STATUS_LABEL, UAT_SCRIPT_STATUS_LABEL, rollupArea } from "@/lib/uat";

const fmt = (d: Date | null) => (d ? format(d, "yyyy-MM-dd") : "");
const INK = "FF141F2B";
const LINE = "FFD9DEE2";
const HEAD_FILL = "FFEDE7D6";
const thin = { style: "thin" as const, color: { argb: LINE } };
const cellBorder = { top: thin, left: thin, bottom: thin, right: thin };
function safeSheetName(name: string, used: Set<string>): string {
  let s = name.replace(/[[\]*?/\\:]/g, " ").trim().slice(0, 28) || "Area";
  const base = s;
  let n = 2;
  while (used.has(s.toLowerCase())) s = `${base.slice(0, 25)} ${n++}`;
  used.add(s.toLowerCase());
  return s;
}

export async function GET(_req: Request, { params }: { params: Promise<{ scriptId: string }> }) {
  const { scriptId } = await params;
  const user = await requireUser();
  const script = await prisma.uatScript.findFirst({
    where: { id: scriptId, companyId: user.companyId },
    select: { id: true, name: true, status: true, sentAt: true, projectId: true, engagement: { select: { name: true } }, project: { select: { name: true, number: true, client: { select: { name: true } } } } },
  });
  if (!script) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!(await canAccessProjectDelivery(user, script.projectId))) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const project = script.project;
  const [areas, cases, issues] = await Promise.all([
    prisma.uatArea.findMany({ where: { scriptId }, orderBy: { sortOrder: "asc" } }),
    prisma.uatTestCase.findMany({ where: { scriptId }, orderBy: { sortOrder: "asc" } }),
    prisma.uatIssue.findMany({ where: { scriptId }, orderBy: { sortOrder: "asc" } }),
  ]);
  const casesOf = (areaId: string) => cases.filter((c) => c.areaId === areaId);

  const used = new Set<string>(["test summary", "test issue summary"]);
  const areaSheet = new Map<string, string>();
  areas.forEach((a) => areaSheet.set(a.id, safeSheetName(a.name || "Area", used)));

  const wb = new ExcelJS.Workbook();
  wb.creator = "RM Ops";

  // ---- Summary sheet ----
  const sum = wb.addWorksheet("Test Summary", { pageSetup: { fitToPage: true, fitToWidth: 1 } });
  sum.columns = [{ width: 34 }, { width: 22 }, { width: 10 }, { width: 8 }, { width: 8 }, { width: 8 }, { width: 10 }];
  let r = 1;
  sum.mergeCells(`A${r}:G${r}`);
  const st = sum.getCell(`A${r}`);
  st.value = `${script.engagement ? `${script.engagement.name} · ` : ""}${project.name} — ${script.name}`;
  st.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  st.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
  st.alignment = { vertical: "middle", indent: 1 };
  sum.getRow(r).height = 30;
  r += 2;
  const meta: [string, string][] = [
    ["Customer", project.client.name],
    ["Test phase", "UAT"],
    ["Script status", UAT_SCRIPT_STATUS_LABEL[script.status] + (script.sentAt ? ` (${fmt(script.sentAt)})` : "")],
    ["Exported", format(new Date(), "yyyy-MM-dd")],
  ];
  for (const [k, v] of meta) {
    sum.getCell(`A${r}`).value = k; sum.getCell(`A${r}`).font = { bold: true, color: { argb: "FF6B7280" } };
    sum.getCell(`B${r}`).value = v;
    r++;
  }
  r++;
  ["Functional area", "Sheet", "Total", "OK", "KO", "Redo", "Not run"].forEach((h, i) => {
    const c = sum.getCell(r, i + 1);
    c.value = h; c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } }; c.border = cellBorder;
  });
  r++;
  const grand = { total: 0, ok: 0, ko: 0, redo: 0, notRun: 0 };
  for (const a of areas) {
    const roll = rollupArea(casesOf(a.id).map((c) => c.result));
    grand.total += roll.total; grand.ok += roll.ok; grand.ko += roll.ko; grand.redo += roll.redo; grand.notRun += roll.notRun;
    const vals = [a.name, areaSheet.get(a.id)!, roll.total, roll.ok, roll.ko, roll.redo, roll.notRun];
    vals.forEach((v, i) => { const c = sum.getCell(r, i + 1); c.value = v as string | number; c.border = cellBorder; });
    r++;
  }
  const gv = ["Total", "", grand.total, grand.ok, grand.ko, grand.redo, grand.notRun];
  gv.forEach((v, i) => { const c = sum.getCell(r, i + 1); c.value = v as string | number; c.font = { bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } }; c.border = cellBorder; });

  // ---- One sheet per functional area ----
  for (const a of areas) {
    const ws = wb.addWorksheet(areaSheet.get(a.id)!, { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 } });
    ws.columns = [{ width: 6 }, { width: 40 }, { width: 30 }, { width: 40 }, { width: 16 }, { width: 13 }, { width: 10 }, { width: 30 }, { width: 14 }, { width: 30 }];
    let rr = 1;
    ws.mergeCells(`A${rr}:J${rr}`);
    const at = ws.getCell(`A${rr}`);
    at.value = a.name; at.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } }; at.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } }; at.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(rr).height = 24;
    rr++;
    const line = (k: string, v: string | null) => {
      if (!v) return;
      ws.getCell(`A${rr}`).value = k; ws.getCell(`A${rr}`).font = { bold: true, color: { argb: "FF6B7280" } };
      ws.mergeCells(`B${rr}:J${rr}`); const c = ws.getCell(`B${rr}`); c.value = v; c.alignment = { wrapText: true, vertical: "top" };
      ws.getRow(rr).height = Math.min(120, 16 + Math.ceil(v.length / 110) * 15);
      rr++;
    };
    line("Client", project.client.name);
    line("Overview", a.overview);
    line("Data requirements", a.dataRequirements);
    rr++;
    ["Test#", "Description", "Prerequisites", "Expected results", "Run by", "Date run", "Result", "Reason for failure", "Doc no", "Comments"].forEach((h, i) => {
      const c = ws.getCell(rr, i + 1); c.value = h; c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } }; c.border = cellBorder;
    });
    rr++;
    casesOf(a.id).forEach((c, ci) => {
      ws.getCell(rr, 1).value = ci + 1;
      ws.getCell(rr, 2).value = c.description ?? ""; ws.getCell(rr, 2).alignment = { wrapText: true, vertical: "top" };
      ws.getCell(rr, 3).value = c.prerequisites ?? ""; ws.getCell(rr, 3).alignment = { wrapText: true, vertical: "top" };
      ws.getCell(rr, 4).value = c.expectedResults ?? ""; ws.getCell(rr, 4).alignment = { wrapText: true, vertical: "top" };
      ws.getCell(rr, 5).value = c.runBy ?? "";
      ws.getCell(rr, 6).value = fmt(c.dateRun);
      const rc = ws.getCell(rr, 7);
      rc.value = UAT_RESULT_LABEL[c.result]; rc.font = { bold: true }; rc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: UAT_RESULT_HEX[c.result] } };
      ws.getCell(rr, 8).value = c.reasonForFailure ?? ""; ws.getCell(rr, 8).alignment = { wrapText: true, vertical: "top" };
      ws.getCell(rr, 9).value = c.docNo ?? "";
      ws.getCell(rr, 10).value = c.comments ?? ""; ws.getCell(rr, 10).alignment = { wrapText: true, vertical: "top" };
      for (let ci2 = 1; ci2 <= 10; ci2++) ws.getCell(rr, ci2).border = cellBorder;
      rr++;
    });
  }

  // ---- Test Issue Summary ----
  const iss = wb.addWorksheet("Test Issue Summary", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 } });
  iss.columns = [{ width: 6 }, { width: 24 }, { width: 8 }, { width: 10 }, { width: 40 }, { width: 40 }, { width: 16 }, { width: 10 }, { width: 13 }, { width: 13 }];
  let ir = 1;
  ["#", "Area / tab", "Test#", "Type", "Description", "Corrective action", "Assigned", "Status", "Raised", "Closed"].forEach((h, i) => {
    const c = iss.getCell(ir, i + 1); c.value = h; c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } }; c.border = cellBorder;
  });
  ir++;
  issues.forEach((i, ii) => {
    iss.getCell(ir, 1).value = ii + 1;
    iss.getCell(ir, 2).value = i.areaRef ?? "";
    iss.getCell(ir, 3).value = i.testRef ?? "";
    iss.getCell(ir, 4).value = i.type ?? "";
    iss.getCell(ir, 5).value = i.description ?? ""; iss.getCell(ir, 5).alignment = { wrapText: true, vertical: "top" };
    iss.getCell(ir, 6).value = i.correctiveAction ?? ""; iss.getCell(ir, 6).alignment = { wrapText: true, vertical: "top" };
    iss.getCell(ir, 7).value = i.assigned ?? "";
    iss.getCell(ir, 8).value = UAT_ISSUE_STATUS_LABEL[i.status];
    iss.getCell(ir, 9).value = fmt(i.dateRaised);
    iss.getCell(ir, 10).value = fmt(i.dateClosed);
    for (let ci = 1; ci <= 10; ci++) iss.getCell(ir, ci).border = cellBorder;
    ir++;
  });

  const buffer = await wb.xlsx.writeBuffer();
  const safe = `${project.number ?? project.name}_${script.engagement ? `${script.engagement.name}_` : ""}${script.name}`.replace(/[^\w-]+/g, "_").slice(0, 60);
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="UAT-${safe}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
