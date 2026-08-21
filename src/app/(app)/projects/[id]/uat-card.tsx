"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ClipboardCheckIcon, SendIcon, CheckCircle2Icon, RotateCcwIcon, CircleDashedIcon,
  UserIcon, CalendarIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { advanceProjectUatAction } from "../actions";

export type UatStatus = "NOT_STARTED" | "SENT" | "ACCEPTED" | "CHANGES_REQUESTED";
export type UatEventItem = { id: string; status: UatStatus; note: string | null; actorName: string; at: string };
export type UatState = {
  status: UatStatus;
  acceptedDate: string | null;
  signatory: string | null;
  notes: string | null;
  recordedByName: string | null;
  recordedAt: string | null;
};

const PHASE: Record<UatStatus, { label: string; pill: string; icon: typeof SendIcon; blurb: string }> = {
  NOT_STARTED: { label: "Not started", pill: "bg-muted text-muted-foreground", icon: CircleDashedIcon, blurb: "UAT hasn't been sent to the customer yet." },
  SENT: { label: "Sent for signature", pill: "bg-blue-500/15 text-blue-700 dark:text-blue-400", icon: SendIcon, blurb: "Waiting for the customer to reply with the signed acceptance." },
  ACCEPTED: { label: "Accepted", pill: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", icon: CheckCircle2Icon, blurb: "Customer signed off — the project can be invoiced." },
  CHANGES_REQUESTED: { label: "Changes requested", pill: "bg-rose-500/15 text-rose-700 dark:text-rose-400", icon: RotateCcwIcon, blurb: "Customer bounced it back — address the changes and re-send." },
};

export function PhasePill({ status, className }: { status: UatStatus; className?: string }) {
  const p = PHASE[status];
  const Icon = p.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", p.pill, className)}>
      <Icon className="size-3.5" /> {p.label}
    </span>
  );
}

export function UatCard({ projectId, canManage, uat, events }: { projectId: string; canManage: boolean; uat: UatState; events: UatEventItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [signatory, setSignatory] = useState(uat.signatory ?? "");
  const [acceptedDate, setAcceptedDate] = useState(uat.acceptedDate ?? "");

  function advance(toStatus: UatStatus, extra?: { signatory?: string | null; acceptedDate?: string | null }, successMsg?: string) {
    start(async () => {
      const r = await advanceProjectUatAction({ projectId, toStatus, note: note.trim() || null, ...extra });
      if (r.error) toast.error(r.error);
      else { toast.success(successMsg ?? "UAT updated."); setNote(""); setAccepting(false); router.refresh(); }
    });
  }
  function accept() {
    advance("ACCEPTED", { signatory: signatory.trim() || null, acceptedDate: acceptedDate || null }, "Recorded as accepted.");
  }

  const p = PHASE[uat.status];

  return (
    <Card className={uat.status === "ACCEPTED" ? "border-emerald-300/70" : undefined}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><ClipboardCheckIcon className="size-4 text-muted-foreground" /> UAT acceptance</CardTitle>
        <PhasePill status={uat.status} />
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="text-sm text-muted-foreground">{p.blurb}</p>

        {/* Acceptance summary when signed off */}
        {uat.status === "ACCEPTED" && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md border bg-emerald-500/5 p-3 text-sm">
            <div className="flex items-center gap-2"><CalendarIcon className="size-4 text-muted-foreground shrink-0" /><div><div className="text-xs text-muted-foreground">Signed off</div><div>{uat.acceptedDate ?? "—"}</div></div></div>
            <div className="flex items-center gap-2"><UserIcon className="size-4 text-muted-foreground shrink-0" /><div><div className="text-xs text-muted-foreground">Signatory</div><div>{uat.signatory ?? "—"}</div></div></div>
          </div>
        )}

        {/* Manager actions */}
        {canManage && (
          <div className="flex flex-col gap-3">
            {accepting ? (
              <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3">
                <div className="text-sm font-medium">Record acceptance</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5"><Label htmlFor="uat-date">Acceptance date</Label><Input id="uat-date" type="date" value={acceptedDate} onChange={(e) => setAcceptedDate(e.target.value)} /></div>
                  <div className="flex flex-col gap-1.5"><Label htmlFor="uat-signatory">Customer signatory</Label><Input id="uat-signatory" value={signatory} onChange={(e) => setSignatory(e.target.value)} placeholder="Name (and role)" maxLength={200} /></div>
                </div>
                <div className="flex flex-col gap-1.5"><Label htmlFor="uat-accnote">Note (optional)</Label><Textarea id="uat-accnote" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} placeholder="Conditions, scope of acceptance…" /></div>
                <div className="flex gap-2"><Button size="sm" onClick={accept} disabled={pending}>{pending ? "Saving…" : "Confirm accepted"}</Button><Button size="sm" variant="outline" onClick={() => setAccepting(false)} disabled={pending}>Cancel</Button></div>
              </div>
            ) : (
              <>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} placeholder="Add a note to the next step (optional)…" />
                <div className="flex flex-wrap gap-2">
                  {(uat.status === "NOT_STARTED" || uat.status === "CHANGES_REQUESTED") && (
                    <Button size="sm" onClick={() => advance("SENT", undefined, "Sent for signature.")} disabled={pending}><SendIcon className="size-3.5" /> {uat.status === "CHANGES_REQUESTED" ? "Re-send for signature" : "Send for signature"}</Button>
                  )}
                  {(uat.status === "SENT" || uat.status === "CHANGES_REQUESTED") && (
                    <Button size="sm" variant={uat.status === "SENT" ? "default" : "outline"} onClick={() => setAccepting(true)} disabled={pending}><CheckCircle2Icon className="size-3.5" /> Mark accepted (signed)</Button>
                  )}
                  {uat.status === "SENT" && (
                    <Button size="sm" variant="outline" className="text-rose-600 hover:text-rose-600 hover:bg-rose-500/10" onClick={() => advance("CHANGES_REQUESTED", undefined, "Marked as changes requested.")} disabled={pending}><RotateCcwIcon className="size-3.5" /> Request changes</Button>
                  )}
                  {uat.status === "ACCEPTED" && (
                    <Button size="sm" variant="outline" onClick={() => advance("SENT", undefined, "Reopened for signature.")} disabled={pending}><RotateCcwIcon className="size-3.5" /> Reopen</Button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* History timeline */}
        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">History</div>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {events.map((e) => {
                const Icon = PHASE[e.status].icon;
                return (
                  <li key={e.id} className="flex gap-3">
                    <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", PHASE[e.status].pill)}><Icon className="size-3.5" /></span>
                    <div className="min-w-0">
                      <div className="text-sm"><span className="font-medium">{PHASE[e.status].label}</span> <span className="text-muted-foreground">· {e.actorName} · {e.at}</span></div>
                      {e.note && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{e.note}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
