import { TICKET_PRIORITY_LABEL } from "@/lib/ticket";
import type { TicketRow } from "./serialize";

// Native (built-in) overview columns. Custom-field columns are addressed as "cf:<fieldKey>".
export const NATIVE_COLUMNS: { key: string; label: string }[] = [
  { key: "number", label: "Number" },
  { key: "title", label: "Title" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "requester", label: "Requester" },
  { key: "assignee", label: "Assignee" },
  { key: "client", label: "Client" },
  { key: "project", label: "Project" },
  { key: "systemRef", label: "System / CI" },
  { key: "moduleRef", label: "Module" },
  { key: "category", label: "Category" },
  { key: "dueDate", label: "Due date" },
  { key: "createdAt", label: "Created" },
  { key: "resolveBy", label: "Resolve by" },
];

export const DEFAULT_COLUMNS = ["number", "title", "type", "status", "priority", "assignee", "client", "created"];
// "created" alias kept for older saved views; canonical key is "createdAt".
function norm(key: string): string {
  return key === "created" ? "createdAt" : key;
}

export function customColumnKey(fieldKey: string): string {
  return `cf:${fieldKey}`;
}

export function columnValue(row: TicketRow, key: string): string {
  const k = norm(key);
  if (k.startsWith("cf:")) return row.fields[k.slice(3)] ?? "";
  switch (k) {
    case "number": return row.number;
    case "title": return row.title;
    case "type": return row.typeName;
    case "status": return row.statusName;
    case "priority": return TICKET_PRIORITY_LABEL[row.priority];
    case "requester": return row.requesterName;
    case "assignee": return row.assigneeName ?? "";
    case "client": return row.clientName ?? "";
    case "project": return row.projectName ?? "";
    case "systemRef": return row.systemRef;
    case "moduleRef": return row.moduleRef;
    case "category": return row.category;
    case "dueDate": return row.dueDate;
    case "createdAt": return row.createdAt ? row.createdAt.slice(0, 10) : "";
    case "resolveBy": return row.resolveBy ? row.resolveBy.slice(0, 10) : "";
    default: return "";
  }
}
