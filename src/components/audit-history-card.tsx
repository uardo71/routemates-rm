import { HistoryIcon, LockIcon } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fieldLabel, formatAuditValue } from "@/lib/audit-diff";
import type { AuditEntry } from "@/lib/audit";

// The "History" card on a record's detail page: who changed what, when, and from what. Entries
// arrive already redacted for the reader (see presentAudit) — this component never decides what
// money a reader may see. Server component; no client state.

const ACTION_LABEL: Record<string, string> = { create: "Created", update: "Changed", delete: "Removed" };
const ACTION_TONE: Record<string, string> = {
  create: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  update: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
  delete: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
};

export function AuditHistoryCard({ entries, title = "History", initial = 8 }: { entries: AuditEntry[]; title?: string; initial?: number }) {
  const anyRedacted = entries.some((e) => e.redacted);
  const head = entries.slice(0, initial);
  const rest = entries.slice(initial);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <HistoryIcon className="size-4 text-muted-foreground" />
          {title}
          <span className="font-normal text-muted-foreground">({entries.length})</span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Every recorded change to this record and its lines, newest first.
          {anyRedacted && (
            <span className="ml-1 inline-flex items-center gap-1">
              <LockIcon className="size-3" /> Amounts are hidden for your role.
            </span>
          )}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-0 px-0">
        {entries.length === 0 ? (
          <p className="px-6 pb-2 text-sm text-muted-foreground">No changes recorded yet.</p>
        ) : (
          <>
            <ol className="divide-y">
              {head.map((e) => <HistoryRow key={e.id} entry={e} />)}
            </ol>
            {rest.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer select-none px-6 py-2 text-xs text-muted-foreground hover:text-foreground">
                  Show {rest.length} older {rest.length === 1 ? "entry" : "entries"}
                </summary>
                <ol className="divide-y border-t">
                  {rest.map((e) => <HistoryRow key={e.id} entry={e} />)}
                </ol>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function HistoryRow({ entry }: { entry: AuditEntry }) {
  const fields = Object.entries(entry.fields);
  return (
    <li className="flex flex-col gap-1.5 px-6 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline" className={ACTION_TONE[entry.action] ?? ""}>{ACTION_LABEL[entry.action] ?? entry.action}</Badge>
        <span className="font-medium">{entry.entityType}{entry.label ? ` · ${entry.label}` : ""}</span>
        <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground tabular-nums">
          {entry.actorName} · {format(new Date(entry.at), "MMM d, yyyy HH:mm")}
        </span>
      </div>
      {fields.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {fields.map(([name, change]) => (
            <FieldLine key={name} name={name} from={change.from} to={change.to} action={entry.action} />
          ))}
        </dl>
      )}
      {fields.length === 0 && <p className="text-xs text-muted-foreground">{entry.summary}</p>}
    </li>
  );
}

function FieldLine({ name, from, to, action }: { name: string; from: AuditEntry["fields"][string]["from"]; to: AuditEntry["fields"][string]["to"]; action: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{fieldLabel(name)}</dt>
      <dd className="font-mono tabular-nums">
        {action === "create" ? (
          formatAuditValue(to)
        ) : action === "delete" ? (
          <span className="line-through opacity-70">{formatAuditValue(from)}</span>
        ) : (
          <>
            <span className="text-muted-foreground line-through">{formatAuditValue(from)}</span>
            <span className="mx-1.5 text-muted-foreground">→</span>
            <span>{formatAuditValue(to)}</span>
          </>
        )}
      </dd>
    </>
  );
}
