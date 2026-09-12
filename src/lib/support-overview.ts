// The Support clients overview: one row per client account, ranked by what actually needs a human.
//
// Pure on purpose (no Prisma, no server-only): the page loads the counts, this decides the order,
// the "needs attention" rule, the filtering and the summary — so the overview table, its chips and
// the per-client workspace tiles can never disagree about what "breached" or "attention" means.
// Same split as delivery-home.ts / actions-register.ts.

export type ClientRow = {
  id: string;
  name: string;
  open: number;
  unassigned: number;
  breached: number;
  critical: number;
  resolved7d: number;
  /** Age of the oldest still-open ticket, in whole days. Null when nothing is open. */
  oldestOpenDays: number | null;
  /** ISO timestamp of the last ticket activity, or "" when the account has never had a ticket. */
  lastActivity: string;
  /** Team leads first, then members — the order the workspace shows them in. */
  team: string[];
  leadCount: number;
};

/** The chips above the table. Each is a filter, not decoration. */
export type OverviewFocus = "attention" | "breached" | "unassigned" | "critical" | "quiet";

export const OVERVIEW_FOCUS_LABEL: Record<OverviewFocus, string> = {
  attention: "Needs attention",
  breached: "Breached",
  unassigned: "Unassigned",
  critical: "Critical",
  quiet: "Quiet",
};

/** An account needs a human when something is late, severe, or nobody has picked it up. */
export function needsAttention(r: ClientRow): boolean {
  return r.breached > 0 || r.critical > 0 || r.unassigned > 0;
}

/** Quiet = nothing open at all. Not the same as "no attention needed": an account can have plenty
 *  of open work that is all assigned and on time. */
export function isQuiet(r: ClientRow): boolean {
  return r.open === 0;
}

/** Worst first. Breached outranks critical outranks unassigned; open work breaks ties above quiet. */
export function attentionScore(r: ClientRow): number {
  return r.breached * 1_000_000 + r.critical * 10_000 + r.unassigned * 100 + Math.min(r.open, 99);
}

export type ClientSortKey =
  | "attention" | "name" | "open" | "breached" | "unassigned" | "critical" | "oldest" | "resolved7d" | "lastActivity";

export function sortClients(rows: ClientRow[], key: ClientSortKey, dir: "asc" | "desc"): ClientRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const num = (r: ClientRow): number => {
    switch (key) {
      case "attention": return attentionScore(r);
      case "open": return r.open;
      case "breached": return r.breached;
      case "unassigned": return r.unassigned;
      case "critical": return r.critical;
      case "resolved7d": return r.resolved7d;
      // No open work sorts as "no age" — below every real age, whichever direction you read it.
      case "oldest": return r.oldestOpenDays ?? -1;
      case "lastActivity": return r.lastActivity ? Date.parse(r.lastActivity) : 0;
      default: return 0;
    }
  };
  return [...rows].sort((a, b) => {
    if (key === "name") return sign * a.name.localeCompare(b.name);
    const d = num(b) - num(a); // numeric columns read high-first by default
    return (sign === 1 ? -d : d) || a.name.localeCompare(b.name);
  });
}

export function filterClients(rows: ClientRow[], opts: { focus?: OverviewFocus | null; q?: string }): ClientRow[] {
  const q = (opts.q ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q) && !r.team.some((t) => t.toLowerCase().includes(q))) return false;
    switch (opts.focus) {
      case "attention": return needsAttention(r);
      case "breached": return r.breached > 0;
      case "unassigned": return r.unassigned > 0;
      case "critical": return r.critical > 0;
      case "quiet": return isQuiet(r);
      default: return true;
    }
  });
}

export type OverviewSummary = {
  clients: number;
  open: number;
  breached: number;
  unassigned: number;
  critical: number;
  resolved7d: number;
  /** How many accounts each chip would show — so a chip can say "Breached (3)" and read 0 when clear. */
  counts: Record<OverviewFocus, number>;
};

export function summarize(rows: ClientRow[]): OverviewSummary {
  const s: OverviewSummary = {
    clients: rows.length, open: 0, breached: 0, unassigned: 0, critical: 0, resolved7d: 0,
    counts: { attention: 0, breached: 0, unassigned: 0, critical: 0, quiet: 0 },
  };
  for (const r of rows) {
    s.open += r.open; s.breached += r.breached; s.unassigned += r.unassigned;
    s.critical += r.critical; s.resolved7d += r.resolved7d;
    if (needsAttention(r)) s.counts.attention++;
    if (r.breached > 0) s.counts.breached++;
    if (r.unassigned > 0) s.counts.unassigned++;
    if (r.critical > 0) s.counts.critical++;
    if (isQuiet(r)) s.counts.quiet++;
  }
  return s;
}

/** "today" / "3d ago" / "no activity" — the same words the cards used. */
export function lastActivityLabel(iso: string, now: number): string {
  if (!iso) return "no activity";
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
