import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { format } from "date-fns";
import { requireUser } from "@/lib/session";
import { actionScope, loadOpenActions } from "@/lib/actions-register-data";
import { ACTION_SOURCE_LABEL, filterActions, type ActionSource } from "@/lib/actions-register";

// XLSX of the actions register with the same filters as the page (mine/unassigned/overdue/
// project/source/q). Same scope rule: managers get their projects, everyone else their own actions.
export async function GET(req: NextRequest) {
  const user = await requireUser();
  const { searchParams: sp } = new URL(req.url);
  const scope = await actionScope(user);
  const todayIso = format(new Date(), "yyyy-MM-dd");
  const all = await loadOpenActions(user, { projectIds: scope.projectIds, mineOnly: scope.mineOnly, todayIso });
  const source = sp.get("source");
  const rows = filterActions(all, {
    mineUserId: sp.get("mine") === "1" || scope.mineOnly ? user.id : null,
    unassigned: sp.get("unassigned") === "1",
    overdue: sp.get("overdue") === "1",
    projectId: sp.get("project"),
    source: source && ["PLAN", "RAID", "STATUS", "MEETING"].includes(source) ? (source as ActionSource) : null,
    q: sp.get("q"),
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Actions");
  ws.columns = [
    { header: "Source", key: "source", width: 16 },
    { header: "Action", key: "title", width: 60 },
    { header: "Project", key: "project", width: 28 },
    { header: "End customer", key: "engagement", width: 22 },
    { header: "Owner", key: "owner", width: 22 },
    { header: "Due", key: "due", width: 12 },
    { header: "Days late", key: "late", width: 10 },
    { header: "Age (days)", key: "age", width: 10 },
    { header: "Status", key: "status", width: 20 },
    { header: "Critical", key: "critical", width: 9 },
    { header: "Raised", key: "raised", width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const a of rows) {
    ws.addRow({
      source: ACTION_SOURCE_LABEL[a.source], title: a.title, project: a.projectName, engagement: a.engagementName ?? "",
      owner: a.owner ?? "", due: a.dueDate ?? "", late: a.isOverdue ? a.overdueDays : "", age: a.ageDays, status: a.status,
      critical: a.critical ? "Yes" : "", raised: a.createdAt.slice(0, 10),
    });
  }
  ws.autoFilter = { from: "A1", to: "K1" };
  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="actions-${todayIso}.xlsx"`,
    },
  });
}
