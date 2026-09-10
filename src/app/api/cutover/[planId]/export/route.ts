import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canAccessProjectCutover } from "@/lib/permissions";
import { CUTOVER_STATUS_LABEL, CUTOVER_STATUS_HEX, hoursValue, rollupStatus } from "@/lib/cutover";

const fmt = (d: Date | null) => (d ? format(d, "yyyy-MM-dd") : "");
const INK = "FF141F2B";
const LINE = "FFD9DEE2";
const HEADER_FILL = "FFEDE7D6";
const thin = { style: "thin" as const, color: { argb: LINE } };
const cellBorder = { top: thin, left: thin, bottom: thin, right: thin };

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x ?? "")) : [];
}
function toGrid(v: unknown): string[][] {
  return Array.isArray(v) ? v.map((r) => toStringArray(r)) : [];
}
function safeSheetName(name: string, used: Set<string>): string {
  let s = name.replace(/[[\]*?/\\:]/g, " ").trim().slice(0, 28) || "List";
  const base = s;
  let n = 2;
  while (used.has(s.toLowerCase())) s = `${base.slice(0, 25)} ${n++}`;
  used.add(s.toLowerCase());
  return s;
}

export async function GET(_req: Request, { params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  const user = await requireUser();
  const plan = await prisma.cutoverPlan.findFirst({
    where: { id: planId, companyId: user.companyId },
    select: { id: true, name: true, projectId: true, engagement: { select: { name: true } }, project: { select: { name: true, number: true, client: { select: { name: true } } } } },
  });
  if (!plan) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!(await canAccessProjectCutover(user, plan.projectId))) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const project = plan.project;
  const [tasks, lists] = await Promise.all([
    prisma.cutoverTask.findMany({ where: { planId }, orderBy: { sortOrder: "asc" } }),
    prisma.cutoverList.findMany({ where: { planId }, orderBy: { sortOrder: "asc" } }),
  ]);

  type Task = (typeof tasks)[number];
  function aggregate(kids: Task[]) {
    const mins = kids.reduce((s, k) => s + (k.durationMinutes ?? 0), 0);
    const starts = kids.map((k) => k.startDate).filter((d): d is Date => !!d).map((d) => d.getTime());
    const ends = kids.map((k) => k.endDate).filter((d): d is Date => !!d).map((d) => d.getTime());
    const responsible = [...new Set(kids.map((k) => (k.responsible ?? "").trim()).filter(Boolean))].join(", ");
    return {
      durationMinutes: mins,
      startDate: starts.length ? new Date(Math.min(...starts)) : null,
      endDate: ends.length ? new Date(Math.max(...ends)) : null,
      responsible,
      status: rollupStatus(kids.map((k) => k.status)),
    };
  }

  const top = tasks.filter((t) => !t.parentId);
  const flat: { t: Task; number: string; depth: number; header: boolean; agg: ReturnType<typeof aggregate> | null }[] = [];
  top.forEach((t, i) => {
    const kids = tasks.filter((x) => x.parentId === t.id);
    flat.push({ t, number: `${i + 1}`, depth: 0, header: kids.length > 0, agg: kids.length > 0 ? aggregate(kids) : null });
    kids.forEach((c, j) => flat.push({ t: c, number: `${i + 1}.${j + 1}`, depth: 1, header: false, agg: null }));
  });

  // Sheet names for the reference lists (Excel: ≤31 chars, no []:*?/\, unique).
  const usedNames = new Set<string>(["cutover plan"]);
  const listSheet = new Map<string, string>(); // list name (lower) → sheet name
  for (const l of lists) if (l.name.trim()) listSheet.set(l.name.trim().toLowerCase(), safeSheetName(l.name.trim(), usedNames));

  const wb = new ExcelJS.Workbook();
  wb.creator = "RM Ops";
  const ws = wb.addWorksheet("Cutover Plan", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } } });
  ws.columns = [{ width: 6 }, { width: 20 }, { width: 30 }, { width: 40 }, { width: 16 }, { width: 16 }, { width: 9 }, { width: 12 }, { width: 12 }, { width: 11 }, { width: 13 }];
  const LAST = "K";
  let row = 1;

  ws.mergeCells(`A${row}:${LAST}${row}`);
  const t = ws.getCell(`A${row}`);
  t.value = `${plan.engagement ? `${plan.engagement.name} · ` : ""}${project.name} — ${plan.name}`;
  t.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
  t.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(row).height = 30;
  row++;
  ws.mergeCells(`A${row}:${LAST}${row}`);
  const sub = ws.getCell(`A${row}`);
  sub.value = `${project.client.name}${project.number ? ` · ${project.number}` : ""} · exported ${format(new Date(), "yyyy-MM-dd")}`;
  sub.font = { color: { argb: "FFC9D1D9" }, size: 11 };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
  sub.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(row).height = 18;
  row += 2;

  const headers = ["#", "Macro activity", "Activity", "Description", "Ref. list", "Responsible", "Prereq.", "Start", "End", "Duration (h)", "Status"];
  headers.forEach((h, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    c.border = cellBorder;
  });
  ws.getRow(row).height = 18;
  row++;

  let totalMin = 0;
  for (const { t: tk, number, depth, header, agg } of flat) {
    const responsible = header ? agg!.responsible : tk.responsible ?? "";
    const startD = header ? agg!.startDate : tk.startDate;
    const endD = header ? agg!.endDate : tk.endDate;
    const durMin = header ? agg!.durationMinutes : tk.durationMinutes;
    const status = header ? agg!.status : tk.status;

    ws.getCell(row, 1).value = number;
    ws.getCell(row, 1).font = { bold: header };
    ws.getCell(row, 2).value = tk.macroActivity;
    const act = ws.getCell(row, 3);
    act.value = tk.activity;
    act.alignment = { wrapText: true, vertical: "top", indent: depth === 1 ? 2 : 0 };
    act.font = { bold: header };
    ws.getCell(row, 4).value = tk.description ?? "";
    ws.getCell(row, 4).alignment = { wrapText: true, vertical: "top" };
    // Ref. list: hyperlink to the list's tab when it exists.
    const refCell = ws.getCell(row, 5);
    const refName = header ? "" : (tk.referenceList ?? "").trim();
    if (refName) {
      const sheet = listSheet.get(refName.toLowerCase());
      if (sheet) { refCell.value = { text: refName, hyperlink: `#'${sheet}'!A1` }; refCell.font = { color: { argb: "FF2563EB" }, underline: true }; }
      else refCell.value = refName;
    }
    ws.getCell(row, 6).value = responsible;
    ws.getCell(row, 7).value = header ? "" : tk.prerequisite ?? "";
    ws.getCell(row, 8).value = fmt(startD);
    ws.getCell(row, 9).value = fmt(endD);
    ws.getCell(row, 10).value = hoursValue(durMin);
    ws.getCell(row, 10).font = { bold: header };
    const sc = ws.getCell(row, 11);
    sc.value = CUTOVER_STATUS_LABEL[status];
    sc.font = { bold: true };
    if (header) {
      for (let ci = 1; ci <= 11; ci++) ws.getCell(row, ci).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    } else {
      sc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CUTOVER_STATUS_HEX[status] } };
    }
    for (let ci = 1; ci <= 11; ci++) ws.getCell(row, ci).border = cellBorder;
    if (!header) totalMin += tk.durationMinutes ?? 0;
    row++;
  }

  ws.getCell(row, 9).value = "Total";
  ws.getCell(row, 9).font = { bold: true };
  ws.getCell(row, 9).alignment = { horizontal: "right" };
  ws.getCell(row, 10).value = hoursValue(totalMin);
  ws.getCell(row, 10).font = { bold: true };
  for (let ci = 1; ci <= 11; ci++) ws.getCell(row, ci).border = cellBorder;
  ws.views = [{ state: "frozen", ySplit: 4 }];

  // ---- One tab per reference list ----
  for (const l of lists) {
    if (!l.name.trim()) continue;
    const sheet = listSheet.get(l.name.trim().toLowerCase())!;
    const columns = toStringArray(l.columns);
    const grid = toGrid(l.rows);
    const lw = wb.addWorksheet(sheet, { pageSetup: { fitToPage: true, fitToWidth: 1 } });
    lw.columns = columns.map(() => ({ width: 24 }));
    let lr = 1;
    lw.mergeCells(1, 1, 1, Math.max(1, columns.length));
    const title = lw.getCell(1, 1);
    title.value = l.name.trim();
    title.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    lw.getRow(1).height = 22;
    lr = 3;
    columns.forEach((c, i) => {
      const cell = lw.getCell(lr, i + 1);
      cell.value = c || `Column ${i + 1}`;
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      cell.border = cellBorder;
    });
    lr++;
    for (const r of grid) {
      for (let ci = 0; ci < columns.length; ci++) {
        const cell = lw.getCell(lr, ci + 1);
        cell.value = r[ci] ?? "";
        cell.border = cellBorder;
      }
      lr++;
    }
    lw.views = [{ state: "frozen", ySplit: 3 }];
  }

  const buffer = await wb.xlsx.writeBuffer();
  const safe = `${project.number ?? project.name}_${plan.engagement ? `${plan.engagement.name}_` : ""}${plan.name}`.replace(/[^\w-]+/g, "_").slice(0, 60);
  const fileName = `Cutover-${safe}.xlsx`;
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
