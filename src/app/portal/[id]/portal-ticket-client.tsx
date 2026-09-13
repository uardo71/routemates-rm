"use client";

import * as React from "react";
import { BackLink } from "@/components/back-link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { statusColor } from "@/lib/ticket-config";
import { TypeChip, StatusChip } from "../../(app)/tickets/ticket-visuals";
import { Conversation, type CommentNode } from "../../(app)/tickets/conversation";
import { addPortalCommentAction, setPortalStatusAction, deletePortalAttachmentAction, editPortalCommentAction, deletePortalCommentAction } from "../portal-actions";

type HistoryItem = { id: string; kind: string; authorName: string; createdAt: string };
export type PortalStage = { name: string | null; description: string | null; index: number | null; total: number | null; rejected: boolean };
export type PortalTicket = {
  id: string; number: string; title: string; description: string;
  typeName: string; typeColor: string | null; typeIcon: string | null;
  statusName: string; statusColor: string | null; createdAt: string;
  stage: PortalStage | null;
  fields: { name: string; display: string; archived: boolean }[];
  settable: { id: string; name: string; color: string | null }[];
  history: HistoryItem[];
};

const fmtDT = (s: string) => (s ? s.slice(0, 16).replace("T", " ") : "");

export function PortalTicketClient({ t, conversation }: { t: PortalTicket; conversation: CommentNode[] }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [err, setErr] = React.useState<string | null>(null);
  const post = React.useCallback((fd: FormData) => addPortalCommentAction(t.id, fd), [t.id]);

  function setStatus(id: string) {
    setErr(null);
    start(async () => { const r = await setPortalStatusAction(t.id, id); if (r?.error) setErr(r.error); else router.refresh(); });
  }

  return (
    <div className="flex flex-col gap-5">
      <BackLink href="/portal" label="My tickets" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono">{t.number}</span>
            <TypeChip name={t.typeName} color={t.typeColor} icon={t.typeIcon} />
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Raised {fmtDT(t.createdAt)}</p>
        </div>
        <StatusChip name={t.statusName} color={t.statusColor} className="px-2.5 py-1 text-sm" />
      </div>

      {err && <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{err}</p>}

      {t.settable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-3">
          <span className="text-sm text-muted-foreground">Update:</span>
          {t.settable.map((s) => (
            <button key={s.id} onClick={() => setStatus(s.id)} disabled={pending} className={cn("rounded-full border px-3 py-1 text-sm hover:opacity-80", statusColor(s.color).chip)}>{s.name}</button>
          ))}
        </div>
      )}

      {t.stage && <StageProgress stage={t.stage} />}

      <div className="rounded-xl border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Description</h2>
        {t.description ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{t.description}</p> : <p className="text-sm text-muted-foreground">No description.</p>}
        {t.fields.length > 0 && (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-sm sm:grid-cols-3">
            {t.fields.map((f) => (
              <div key={`${f.name}:${f.archived}`} className="flex flex-col">
                <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  {f.name}
                  {f.archived && <span className="ml-1.5 rounded bg-muted px-1 py-px text-[0.55rem]">archived field</span>}
                </dt>
                <dd className={cn("mt-0.5", f.archived && "text-muted-foreground")}>{f.display}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Conversation</h2>
        {t.history.length > 0 && (
          <div className="mb-3 flex flex-col gap-1.5 border-b pb-3">
            {t.history.map((h) => (
              <div key={h.id} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{h.authorName}</span> {h.kind === "CREATED" ? "opened the ticket" : h.kind === "RESOLVED" ? "marked it resolved" : "reopened it"} · {fmtDT(h.createdAt)}
              </div>
            ))}
          </div>
        )}
        <Conversation comments={conversation} canInternal={false} postAction={post} deleteAttachmentAction={deletePortalAttachmentAction} editAction={editPortalCommentAction} deleteCommentAction={deletePortalCommentAction} emptyLabel="No replies yet — add one below." />
      </div>
    </div>
  );
}

/** A STAGE-mode ticket's progress — the customer-visible stage list, replacing what used to be one
 *  frozen status chip for the ticket's whole life. `stage.name` is null when nothing customer-visible
 *  exists yet (e.g. the ticket is on the very first, internal-only stage) — shown as a plain waiting
 *  message rather than a bar with nothing to point at. */
function StageProgress({ stage }: { stage: PortalStage }) {
  if (stage.rejected) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <h2 className="text-sm font-semibold text-destructive">{stage.name}</h2>
        {stage.description && <p className="mt-1 text-sm text-muted-foreground">{stage.description}</p>}
      </div>
    );
  }
  if (!stage.name) {
    return (
      <div className="rounded-xl border bg-card p-4">
        <p className="text-sm text-muted-foreground">Being reviewed — we&apos;ll update this once it moves to the next step.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{stage.name}</h2>
        {stage.index != null && stage.total != null && (
          <span className="text-xs text-muted-foreground">Step {stage.index} of {stage.total}</span>
        )}
      </div>
      {stage.index != null && stage.total != null && stage.total > 1 && (
        <div className="mt-2 flex gap-1">
          {Array.from({ length: stage.total }, (_, i) => (
            <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < stage.index! ? "bg-primary" : "bg-muted")} />
          ))}
        </div>
      )}
      {stage.description && <p className="mt-2 text-sm text-muted-foreground">{stage.description}</p>}
    </div>
  );
}
