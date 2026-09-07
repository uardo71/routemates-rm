import type { TicketPriority, TicketActivityKind } from "@prisma/client";

// Pure helpers + labels for the ticketing module — client & server safe.
// Ticket TYPES and STATUSES are configurable per company (see ticket-config.ts + the DB config
// tables); only priority and the activity-kind vocabulary remain fixed here.

export const TICKET_PRIORITIES: TicketPriority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
export const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };
export const TICKET_PRIORITY_TONE: Record<TicketPriority, string> = {
  LOW: "bg-muted text-muted-foreground",
  MEDIUM: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  HIGH: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  CRITICAL: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};
export const TICKET_PRIORITY_DOT: Record<TicketPriority, string> = {
  LOW: "bg-muted-foreground/40",
  MEDIUM: "bg-sky-500",
  HIGH: "bg-amber-500",
  CRITICAL: "bg-rose-500",
};

export const TICKET_ACTIVITY_LABEL: Record<TicketActivityKind, string> = {
  CREATED: "created the ticket",
  COMMENT: "commented",
  STATUS: "changed status",
  ASSIGN: "changed the assignee",
  PRIORITY: "changed priority",
  RESOLVED: "resolved the ticket",
  REOPENED: "reopened the ticket",
};

// SLA response/resolution targets per priority, in calendar hours from creation.
export const SLA_HOURS: Record<TicketPriority, { respond: number; resolve: number }> = {
  CRITICAL: { respond: 2, resolve: 8 },
  HIGH: { respond: 4, resolve: 24 },
  MEDIUM: { respond: 8, resolve: 72 },
  LOW: { respond: 24, resolve: 168 },
};
export function slaLabel(p: TicketPriority): string {
  const s = SLA_HOURS[p];
  return `respond ${fmtHours(s.respond)} · resolve ${fmtHours(s.resolve)}`;
}
export function addHours(d: Date, h: number): Date {
  return new Date(d.getTime() + h * 3600_000);
}
export function fmtHours(h: number): string {
  if (h % 24 === 0) return `${h / 24}d`;
  return `${h}h`;
}
