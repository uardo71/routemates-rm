import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { requirePermission } from "@/lib/session";
import { loadAuditLog, parseAuditFilter } from "@/lib/audit";
import { fieldLabel, formatAuditValue } from "@/lib/audit-diff";

// XLSX export of /admin/audit with the same query string (entity/actor/from/to/q). One row per
// changed field so a reviewer can filter by field in Excel; rows with no field diff (notes only)
// still appear once. Same gate and the same redaction as the page — amounts a reader may not see
// on screen never reach the workbook either.
export async function GET(req: NextRequest) {
  const user = await requirePermission("audit:view");
  const { searchParams } = new URL(req.url);
  const sp: Record<string, string> = {};
  for (const [k, v] of searchParams.entries()) sp[k] = v;
  const filter = parseAuditFilter(sp);
  const entries = await loadAuditLog(user, filter, 10_000);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Audit log");
  ws.columns = [
    { header: "When (UTC)", key: "at", width: 20 },
    { header: "Actor", key: "actor", width: 22 },
    { header: "Action", key: "action", width: 10 },
    { header: "Entity", key: "entity", width: 20 },
    { header: "Record", key: "label", width: 28 },
    { header: "Field", key: "field", width: 22 },
    { header: "From", key: "from", width: 22 },
    { header: "To", key: "to", width: 22 },
    { header: "Summary", key: "summary", width: 60 },
    { header: "Entity id", key: "entityId", width: 28 },
    { header: "Entry id", key: "id", width: 28 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  for (const e of entries) {
    const base = {
      at: e.at.replace("T", " ").slice(0, 19),
      actor: e.actorName,
      action: e.action,
      entity: e.entityType,
      label: e.label ?? "",
      summary: e.summary,
      entityId: e.entityId,
      id: e.id,
    };
    const fields = Object.entries(e.fields);
    if (fields.length === 0) {
      ws.addRow({ ...base, field: "", from: "", to: "" });
      continue;
    }
    for (const [name, c] of fields) {
      ws.addRow({ ...base, field: fieldLabel(name), from: formatAuditValue(c.from), to: formatAuditValue(c.to) });
    }
  }
  ws.autoFilter = { from: "A1", to: "K1" };

  const buffer = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="audit-log-${stamp}.xlsx"`,
    },
  });
}
