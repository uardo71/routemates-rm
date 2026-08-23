// Plain (non-"use server") helpers for the cutover plan — a Server Actions file may only export async
// functions, so the row type and the DB→row serializer live here and are imported by both the actions
// file and the page.

export type CutoverStatusStr = "PENDING" | "IN_PROGRESS" | "DONE" | "BLOCKED" | "SKIPPED";

export type CutoverRowData = {
  id: string;
  parentId: string | null;
  macroActivity: string;
  activity: string;
  description: string;
  responsible: string;
  prerequisite: string;
  referenceList: string;
  startDate: string;
  endDate: string;
  durationMinutes: number | null;
  status: CutoverStatusStr;
};

type DbCutover = {
  id: string;
  parentId: string | null;
  macroActivity: string;
  activity: string;
  description: string | null;
  responsible: string | null;
  prerequisite: string | null;
  referenceList: string | null;
  startDate: Date | null;
  endDate: Date | null;
  durationMinutes: number | null;
  status: CutoverStatusStr;
};

export function serializeCutover(t: DbCutover): CutoverRowData {
  return {
    id: t.id,
    parentId: t.parentId,
    macroActivity: t.macroActivity,
    activity: t.activity,
    description: t.description ?? "",
    responsible: t.responsible ?? "",
    prerequisite: t.prerequisite ?? "",
    referenceList: t.referenceList ?? "",
    startDate: t.startDate ? t.startDate.toISOString().slice(0, 10) : "",
    endDate: t.endDate ? t.endDate.toISOString().slice(0, 10) : "",
    durationMinutes: t.durationMinutes,
    status: t.status,
  };
}

export type CutoverListData = { id: string; name: string; columns: string[]; rows: string[][] };

export function serializeCutoverList(l: { id: string; name: string; columns: unknown; rows: unknown }): CutoverListData {
  const columns = Array.isArray(l.columns) ? (l.columns as unknown[]).map((c) => String(c)) : [];
  const rows = Array.isArray(l.rows) ? (l.rows as unknown[]).map((r) => (Array.isArray(r) ? (r as unknown[]).map((c) => String(c)) : [])) : [];
  return { id: l.id, name: l.name, columns, rows };
}
