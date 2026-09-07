import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { toDateParam } from "@/lib/week";
import { loadUnbilledEntries, summarizeAge, bucketForAge } from "@/lib/wip-data";

// Unbilled (WIP) export: every approved, billable time entry not yet attached to an invoice line,
// one row each — the month-end accrual worksheet. Same shape as the expenses export (GET with
// searchParams, scoped by permission), rendered as XLSX. Gated on reports:view like /revenue.
export async function GET(req: NextRequest) {
  const user = await requirePermission("reports:view");
  const { searchParams } = new URL(req.url);
  const client = searchParams.get("client");
  const projectId = searchParams.get("projectId");
  const month = searchParams.get("month"); // yyyy-MM

  const company = await prisma.company.findUnique({ where: { id: user.companyId }, select: { currency: true } });
  const currency = company?.currency ?? "EUR";

  const all = await loadUnbilledEntries(user);
  const entries = all.filter((e) => {
    if (client && e.clientName !== client) return false;
    if (projectId && e.projectId !== projectId) return false;
    if (month && e.month !== month) return false;
    return true;
  });

  const wb = new ExcelJS.Workbook();

  // Sheet 1 — the detail rows.
  const ws = wb.addWorksheet("Unbilled");
  ws.columns = [
    { header: "Client", key: "client", width: 24 },
    { header: "Project", key: "project", width: 30 },
    { header: "Milestone", key: "milestone", width: 28 },
    { header: "Month", key: "month", width: 10 },
    { header: "Date", key: "date", width: 12 },
    { header: "Person", key: "person", width: 22 },
    { header: "Hours", key: "hours", width: 10 },
    { header: `Bill rate (${currency})`, key: "rate", width: 16 },
    { header: `Value (${currency})`, key: "value", width: 14 },
    { header: "Age (days)", key: "age", width: 12 },
    { header: "Age bucket", key: "bucket", width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const e of entries) {
    ws.addRow({
      client: e.clientName,
      project: e.projectName,
      milestone: e.milestoneName,
      month: e.month,
      date: e.date,
      person: e.userName,
      hours: e.hours,
      rate: e.rate,
      value: e.value,
      age: e.ageDays,
      bucket: bucketForAge(e.ageDays),
    });
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
  const totalHours = entries.reduce((s, e) => s + e.hours, 0);
  const totalValue = entries.reduce((s, e) => s + e.value, 0);
  const totalRow = ws.addRow({ milestone: "TOTAL", hours: Math.round(totalHours * 100) / 100, value: Math.round(totalValue * 100) / 100 });
  totalRow.font = { bold: true };

  // Sheet 2 — the age summary, so the 90+ number is impossible to miss.
  const ageWs = wb.addWorksheet("Age summary");
  ageWs.columns = [
    { header: "Age bucket", key: "bucket", width: 16 },
    { header: "Entries", key: "entries", width: 10 },
    { header: "Hours", key: "hours", width: 12 },
    { header: `Value (${currency})`, key: "value", width: 16 },
  ];
  ageWs.getRow(1).font = { bold: true };
  for (const b of summarizeAge(entries)) {
    ageWs.addRow({ bucket: b.label, entries: b.entries, hours: b.hours, value: b.value });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="unbilled-${toDateParam(new Date())}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
