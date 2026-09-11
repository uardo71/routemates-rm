import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { visibleTicketWhere } from "@/lib/permissions";
import { loadTicketConfig } from "@/lib/ticket-config.server";
import { serializeTicketRow, customColumnsOf, TICKET_ROW_SELECT } from "../../../(app)/tickets/serialize";
import { NATIVE_COLUMNS, DEFAULT_COLUMNS, columnValue } from "../../../(app)/tickets/columns";
import { filterRows, sortRows, normalizeFilters, type TicketFilters } from "../../../(app)/tickets/filters";

export async function POST(req: NextRequest) {
  const user = await requireUser();
  const cfg = await loadTicketConfig(user.companyId);

  let rawFilters: unknown = {};
  let columns: string[] = DEFAULT_COLUMNS;
  let sort: { key: string; dir: "asc" | "desc" } | null = { key: "createdAt", dir: "desc" };
  try {
    const form = await req.formData();
    const parsed = JSON.parse(String(form.get("payload") ?? "{}"));
    if (parsed.filters) rawFilters = parsed.filters;
    if (Array.isArray(parsed.columns) && parsed.columns.length) columns = parsed.columns;
    if (parsed.sort !== undefined) sort = parsed.sort;
  } catch { /* fall back to defaults */ }

  const ticketWhere = await visibleTicketWhere(user);

  const [tickets, users, clients] = await Promise.all([
    prisma.ticket.findMany({ where: ticketWhere, select: TICKET_ROW_SELECT, orderBy: { createdAt: "desc" } }),
    prisma.user.findMany({ where: { companyId: user.companyId }, select: { id: true, name: true } }),
    prisma.client.findMany({ where: { companyId: user.companyId }, select: { id: true, name: true } }),
  ]);
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  // Clients and people are matched by id (the workspace pins its own clientId); an older payload
  // that still carries names is translated the same way saved views are.
  const filters: TicketFilters = normalizeFilters(rawFilters, users, clients);
  const rows = sortRows(filterRows(tickets.map((t) => serializeTicketRow(t, cfg, (id) => nameById.get(id) ?? "—")), filters, user.id), sort);

  // Column labels (native + custom field names; archived fields read "Name (archived)")
  const { customColumns, archivedColumns } = customColumnsOf(cfg);
  const customLabels = new Map<string, string>();
  for (const c of [...customColumns, ...archivedColumns]) customLabels.set(`cf:${c.key}`, c.label);
  const labelOf = (key: string) => NATIVE_COLUMNS.find((c) => c.key === key)?.label ?? customLabels.get(key) ?? key;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Tickets");
  ws.columns = columns.map((k) => ({ header: labelOf(k), key: k, width: k === "title" ? 40 : 18 }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(Object.fromEntries(columns.map((k) => [k, columnValue(r, k)])));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, columns.length) } };

  const buffer = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="tickets-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
