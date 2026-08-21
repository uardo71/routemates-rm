"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { PlusIcon, PencilIcon, XIcon, SendIcon, FileTextIcon, ArrowRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InfoField } from "@/components/info-field";
import { StatusStamp, type StampTone } from "@/components/status-stamp";
import { DocumentsCard } from "@/components/documents-card";

const OPP_DOC_KINDS = [
  { value: "SOW", label: "SoW" },
  { value: "PO", label: "PO" },
  { value: "OTHER", label: "Other" },
];
import { formatMoney, formatNumber } from "@/lib/format";
import { STAGE_LABELS, isOpenStage } from "@/lib/opportunity";
import type { OpportunityStage, ProjectBillingType, DiscountType } from "@prisma/client";

const STAGE_STAMP: Record<OpportunityStage, { tone: StampTone; dashed?: boolean }> = {
  QUALIFYING: { tone: "neutral", dashed: true },
  PROPOSAL_SENT: { tone: "blue" },
  NEGOTIATION: { tone: "amber" },
  PENDING_APPROVAL: { tone: "amber", dashed: true },
  WON: { tone: "green" },
  LOST: { tone: "rust" },
  CANCELLED: { tone: "neutral" },
};
import {
  updateOpportunityAction,
  addLineAction,
  updateLineAction,
  deleteLineAction,
  setStageAction,
  issueProposalAction,
  submitForApprovalAction,
  recallSubmissionAction,
  markLostAction,
  decideOpportunityAction,
  uploadOpportunityDocumentAction,
  deleteOpportunityDocumentAction,
  createAmendmentAction,
} from "../actions";

export type QuoteLineDTO = {
  id: string;
  name: string;
  description: string | null;
  quantityHours: number;
  unitPrice: number;
  billable: boolean;
};
export type RevisionDTO = {
  id: string;
  version: number;
  label: string | null;
  note: string | null;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  issuedByName: string;
  createdAt: string;
};
export type MilestoneOption = { id: string; name: string };
export type AmendmentLineDTO = {
  name: string;
  quantityHours: number;
  unitPrice: number;
  billable: boolean;
  target: string;
  createdMilestoneId: string | null;
};
export type AmendmentDTO = {
  id: string;
  version: number;
  reference: string | null;
  poNumber: string | null;
  signedDate: string | null;
  note: string | null;
  addedHours: number;
  netAmount: number;
  appliedByName: string;
  createdAt: string;
  lines: AmendmentLineDTO[];
};
export type OpportunityDetail = {
  id: string;
  name: string;
  number: string | null;
  reference: string | null;
  stage: OpportunityStage;
  billingType: ProjectBillingType;
  currency: string;
  clientId: string;
  clientName: string;
  contactId: string | null;
  contactName: string | null;
  ownerId: string;
  ownerName: string;
  probability: number | null;
  expectedCloseDate: string | null;
  discountType: DiscountType | null;
  discountValue: number | null;
  sowNumber: string | null;
  sowSignedDate: string | null;
  poNumber: string | null;
  poAmount: number | null;
  poDate: string | null;
  lostReason: string | null;
  decisionComment: string | null;
  submittedByName: string | null;
  decidedByName: string | null;
  projectId: string | null;
  projectName: string | null;
  gross: number;
  discountAmount: number;
  net: number;
  lines: QuoteLineDTO[];
  revisions: RevisionDTO[];
  documents: { id: string; kind: string; fileName: string; originalName: string }[];
  projectMilestones: MilestoneOption[];
  amendments: AmendmentDTO[];
};

type Option = { id: string; name: string };
type ContactOption = { id: string; name: string; clientId: string };

const BILLING_TYPES: ProjectBillingType[] = ["TIME_AND_MATERIALS", "FIXED_PRICE", "RETAINER"];

export function OpportunityDetailClient({
  detail,
  canManage,
  canApprove,
  clients,
  contacts,
  owners,
}: {
  detail: OpportunityDetail;
  canManage: boolean;
  canApprove: boolean;
  clients: Option[];
  contacts: ContactOption[];
  owners: Option[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [lineDialog, setLineDialog] = useState<{ mode: "add" } | { mode: "edit"; line: QuoteLineDTO } | null>(null);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [decideOpen, setDecideOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [amendmentOpen, setAmendmentOpen] = useState(false);

  const isOpen = isOpenStage(detail.stage);
  const isPending = detail.stage === "PENDING_APPROVAL";
  const linesEditable = isOpen && canManage;
  const c = detail.currency;

  function run(fn: () => Promise<{ error?: string }>, successMsg: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error);
      else {
        toast.success(successMsg);
        router.refresh();
      }
    });
  }

  const discountLabel = detail.discountType
    ? detail.discountType === "PERCENT"
      ? `${formatNumber(detail.discountValue ?? 0)}%`
      : formatMoney(detail.discountValue ?? 0, c)
    : "—";

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold">{detail.name}</h1>
            <StatusStamp label={STAGE_LABELS[detail.stage]} {...STAGE_STAMP[detail.stage]} />
          </div>
          <p className="text-sm text-muted-foreground">
            {detail.number && <span className="font-mono text-foreground">{detail.number}</span>}
            {detail.number && " · "}
            {detail.clientName}
            {detail.contactName ? ` · ${detail.contactName}` : ""} · {detail.billingType.replaceAll("_", " ")} ·{" "}
            Owner: {detail.ownerName}
            {detail.reference ? ` · Ref ${detail.reference}` : ""}
          </p>
        </div>
        {canManage && (isOpen || isPending) && (
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} disabled={pending}>
            <PencilIcon /> Edit details
          </Button>
        )}
      </div>

      {/* Won / Lost banners */}
      {detail.stage === "WON" && detail.projectId && (
        <Card>
          <CardContent className="flex items-center justify-between gap-3">
            <div className="text-sm">
              Won and converted to project <span className="font-medium">{detail.projectName}</span>
              {detail.decidedByName ? ` — approved by ${detail.decidedByName}` : ""}.
            </div>
            <Link href={`/projects/${detail.projectId}`}>
              <Button size="sm" variant="outline">
                Open project <ArrowRightIcon />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
      {detail.stage === "LOST" && (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            Marked lost{detail.lostReason ? `: ${detail.lostReason}` : "."}
          </CardContent>
        </Card>
      )}

      {/* Value summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col gap-1">
            <div className="text-sm text-muted-foreground">List total</div>
            <div className="text-2xl font-semibold tabular-nums">{formatMoney(detail.gross, c)}</div>
            <div className="text-xs text-muted-foreground">{detail.lines.length} line(s)</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1">
            <div className="text-sm text-muted-foreground">Discount</div>
            <div className="text-2xl font-semibold tabular-nums text-amber-500">−{formatMoney(detail.discountAmount, c)}</div>
            <div className="text-xs text-muted-foreground">{discountLabel}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1">
            <div className="text-sm text-muted-foreground">Contract value (net)</div>
            <div className="text-2xl font-semibold tabular-nums text-primary">{formatMoney(detail.net, c)}</div>
            <div className="text-xs text-muted-foreground">carried to the project on win</div>
          </CardContent>
        </Card>
      </div>

      {/* Action bar */}
      {(canManage || canApprove) && detail.stage !== "WON" && detail.stage !== "LOST" && detail.stage !== "CANCELLED" && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2">
            {linesEditable && (
              <>
                <Button size="sm" variant="outline" onClick={() => setProposalOpen(true)} disabled={pending}>
                  <FileTextIcon /> Issue proposal
                </Button>
                <Button size="sm" onClick={() => run(() => submitForApprovalAction(detail.id), "Submitted for approval.")} disabled={pending}>
                  <SendIcon /> Submit for approval
                </Button>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Stage:</span>
                  <Select
                    value={detail.stage}
                    items={(["QUALIFYING", "PROPOSAL_SENT", "NEGOTIATION"] as const).map((s) => ({ value: s, label: STAGE_LABELS[s] }))}
                    onValueChange={(v) => v && v !== detail.stage && run(() => setStageAction({ opportunityId: detail.id, stage: v as "QUALIFYING" | "PROPOSAL_SENT" | "NEGOTIATION" }), "Stage updated.")}
                  >
                    <SelectTrigger className="w-40 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["QUALIFYING", "PROPOSAL_SENT", "NEGOTIATION"] as const).map((s) => (
                        <SelectItem key={s} value={s}>
                          {STAGE_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setLostOpen(true)} disabled={pending}>
                  Mark lost
                </Button>
              </>
            )}
            {isPending && canManage && (
              <Button size="sm" variant="outline" onClick={() => run(() => recallSubmissionAction(detail.id), "Recalled to negotiation.")} disabled={pending}>
                Recall submission
              </Button>
            )}
            {isPending && canApprove && (
              <>
                <span className="text-sm text-muted-foreground">Awaiting your approval{detail.submittedByName ? ` (submitted by ${detail.submittedByName})` : ""}.</span>
                <Button size="sm" onClick={() => setDecideOpen(true)} disabled={pending}>
                  Review & decide
                </Button>
              </>
            )}
            {isPending && !canApprove && !canManage && (
              <span className="text-sm text-muted-foreground">Pending admin approval.</span>
            )}
          </CardContent>
        </Card>
      )}

      {/* Quote lines */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Quote lines</CardTitle>
          {linesEditable && (
            <Button size="sm" variant="outline" onClick={() => setLineDialog({ mode: "add" })} disabled={pending}>
              <PlusIcon /> Add line
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role / workstream</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Line total</TableHead>
                <TableHead>Billable</TableHead>
                {linesEditable && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">
                    {l.name}
                    {l.description ? <span className="block text-xs text-muted-foreground">{l.description}</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(l.quantityHours)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(l.unitPrice, c)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(l.quantityHours * l.unitPrice, c)}</TableCell>
                  <TableCell>{l.billable ? <Badge variant="secondary">Billable</Badge> : <Badge variant="outline">Internal</Badge>}</TableCell>
                  {linesEditable && (
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setLineDialog({ mode: "edit", line: l })} disabled={pending}>
                        <PencilIcon className="size-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm("Delete this line?")) run(() => deleteLineAction(detail.id, l.id), "Line deleted.");
                        }}
                        disabled={pending}
                      >
                        <XIcon className="size-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {detail.lines.length === 0 && (
                <TableRow>
                  <TableCell colSpan={linesEditable ? 6 : 5} className="text-center text-muted-foreground">
                    No quote lines yet.{linesEditable ? " Add roles/workstreams with hours × rate." : ""}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {detail.lines.length > 0 && (
            <div className="mt-3 flex flex-col items-end gap-0.5 text-sm">
              <div className="flex gap-6">
                <span className="text-muted-foreground">List total</span>
                <span className="tabular-nums w-32 text-right">{formatMoney(detail.gross, c)}</span>
              </div>
              <div className="flex gap-6">
                <span className="text-muted-foreground">Discount ({discountLabel})</span>
                <span className="tabular-nums w-32 text-right text-amber-500">−{formatMoney(detail.discountAmount, c)}</span>
              </div>
              <div className="flex gap-6 font-semibold">
                <span>Contract value</span>
                <span className="tabular-nums w-32 text-right">{formatMoney(detail.net, c)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* SoW / PO + meta */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SoW & Purchase Order</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <InfoField icon={FileTextIcon} label="SoW number" value={detail.sowNumber ?? "—"} />
            <InfoField icon={FileTextIcon} label="SoW signed" value={detail.sowSignedDate ?? "—"} />
            <InfoField icon={FileTextIcon} label="PO number" value={detail.poNumber ?? "—"} />
            <InfoField icon={FileTextIcon} label="PO amount" value={detail.poAmount != null ? formatMoney(detail.poAmount, c) : "—"} />
            <InfoField icon={FileTextIcon} label="PO date" value={detail.poDate ?? "—"} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <InfoField icon={FileTextIcon} label="Expected close" value={detail.expectedCloseDate ?? "—"} />
            <InfoField icon={FileTextIcon} label="Win probability" value={detail.probability != null ? `${detail.probability}%` : "—"} />
            <InfoField icon={FileTextIcon} label="Currency" value={detail.currency} />
            {detail.decisionComment ? <InfoField icon={FileTextIcon} label="Decision note" value={detail.decisionComment} /> : null}
          </CardContent>
        </Card>
      </div>

      <DocumentsCard
        title="Documents (SoW / PO)"
        documents={detail.documents}
        kinds={OPP_DOC_KINDS}
        canManage={canManage}
        uploadAction={uploadOpportunityDocumentAction.bind(null, detail.id)}
        deleteAction={deleteOpportunityDocumentAction}
      />

      {/* Proposal revisions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proposal history</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Label</TableHead>
                <TableHead className="text-right">List</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead>Issued by</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.revisions.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">v{r.version}</TableCell>
                  <TableCell>
                    {r.label ?? <span className="text-muted-foreground">—</span>}
                    {r.note ? <span className="block text-xs text-muted-foreground">{r.note}</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.grossAmount, c)}</TableCell>
                  <TableCell className="text-right tabular-nums text-amber-500">−{formatMoney(r.discountAmount, c)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {(() => {
                      // Incremental discount vs the previous version — shows what this revision added
                      // (or gave back), so successive discounts read naturally instead of as a running total.
                      const prev = detail.revisions.find((x) => x.version === r.version - 1);
                      if (!prev) return <span className="text-muted-foreground">—</span>;
                      const delta = Math.round((r.discountAmount - prev.discountAmount) * 100) / 100;
                      if (delta === 0) return <span className="text-muted-foreground">—</span>;
                      return delta > 0
                        ? <span className="text-amber-500">−{formatMoney(delta, c)}</span>
                        : <span className="text-emerald-600">+{formatMoney(-delta, c)}</span>;
                    })()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{formatMoney(r.netAmount, c)}</TableCell>
                  <TableCell className="text-muted-foreground">{r.issuedByName}</TableCell>
                  <TableCell className="text-muted-foreground">{r.createdAt}</TableCell>
                </TableRow>
              ))}
              {detail.revisions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    No proposals issued yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Amendments (change-orders on a won deal) */}
      {detail.stage === "WON" && detail.projectId && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Amendments</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Add hours after the deal closed — each appends to the project and raises its contract value.
              </p>
            </div>
            {canApprove && (
              <Button size="sm" variant="outline" onClick={() => setAmendmentOpen(true)} disabled={pending}>
                <PlusIcon /> Add amendment
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Amendment</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Signed</TableHead>
                  <TableHead className="text-right">Added hours</TableHead>
                  <TableHead className="text-right">Added value</TableHead>
                  <TableHead>Applied by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.amendments.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium align-top">
                      A{a.version}
                      <span className="block text-xs text-muted-foreground font-normal">
                        {a.lines
                          .map((l) => `${l.name} (+${formatNumber(l.quantityHours)}h${l.target === "NEW" ? ", new milestone" : ""})`)
                          .join("; ")}
                      </span>
                      {a.note ? <span className="block text-xs text-muted-foreground font-normal italic">{a.note}</span> : null}
                    </TableCell>
                    <TableCell className="align-top">
                      {a.reference ?? <span className="text-muted-foreground">—</span>}
                      {a.poNumber ? <span className="block text-xs text-muted-foreground">PO {a.poNumber}</span> : null}
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">{a.signedDate ?? "—"}</TableCell>
                    <TableCell className="align-top text-right tabular-nums">+{formatNumber(a.addedHours)}</TableCell>
                    <TableCell className="align-top text-right tabular-nums font-medium">+{formatMoney(a.netAmount, c)}</TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      {a.appliedByName}
                      <span className="block text-xs">{a.createdAt}</span>
                    </TableCell>
                  </TableRow>
                ))}
                {detail.amendments.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No amendments yet.{canApprove ? " Use “Add amendment” when more hours are agreed." : ""}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {detail.amendments.length > 0 && (
              <div className="mt-3 flex flex-col items-end gap-0.5 text-sm">
                <div className="flex gap-6 font-semibold">
                  <span>Total amended</span>
                  <span className="tabular-nums w-40 text-right">
                    +{formatNumber(detail.amendments.reduce((s, a) => s + a.addedHours, 0))}h ·{" "}
                    +{formatMoney(detail.amendments.reduce((s, a) => s + a.netAmount, 0), c)}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {editOpen && (
        <EditDetailsDialog
          detail={detail}
          clients={clients}
          contacts={contacts}
          owners={owners}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            router.refresh();
          }}
        />
      )}
      {lineDialog && (
        <LineDialog
          opportunityId={detail.id}
          state={lineDialog}
          onClose={() => setLineDialog(null)}
          onSaved={() => {
            setLineDialog(null);
            router.refresh();
          }}
        />
      )}
      {proposalOpen && (
        <ProposalDialog
          opportunityId={detail.id}
          onClose={() => setProposalOpen(false)}
          onSaved={() => {
            setProposalOpen(false);
            router.refresh();
          }}
        />
      )}
      {lostOpen && (
        <LostDialog
          opportunityId={detail.id}
          onClose={() => setLostOpen(false)}
          onSaved={() => {
            setLostOpen(false);
            router.refresh();
          }}
        />
      )}
      {decideOpen && (
        <DecisionDialog
          detail={detail}
          onClose={() => setDecideOpen(false)}
          onApproved={(projectId) => {
            setDecideOpen(false);
            router.push(`/projects/${projectId}`);
          }}
          onRejected={() => {
            setDecideOpen(false);
            router.refresh();
          }}
        />
      )}
      {amendmentOpen && (
        <AmendmentDialog
          opportunityId={detail.id}
          currency={c}
          billingType={detail.billingType}
          milestones={detail.projectMilestones}
          onClose={() => setAmendmentOpen(false)}
          onSaved={() => {
            setAmendmentOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------- Amendment (change-order) dialog ----------
type AmendmentDraftLine = { name: string; hours: string; price: string; billable: boolean; target: string };

function AmendmentDialog({
  opportunityId,
  currency,
  billingType,
  milestones,
  onClose,
  onSaved,
}: {
  opportunityId: string;
  currency: string;
  billingType: ProjectBillingType;
  milestones: MilestoneOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [reference, setReference] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [signedDate, setSignedDate] = useState("");
  const [note, setNote] = useState("");
  const emptyLine = (): AmendmentDraftLine => ({ name: "", hours: "", price: "", billable: true, target: "NEW" });
  const [lines, setLines] = useState<AmendmentDraftLine[]>([emptyLine()]);

  const isFixedPrice = billingType === "FIXED_PRICE";
  const rateLabel = isFixedPrice ? "Rate (× hours = lump)" : "Rate / hour";
  const targetItems = [
    { value: "NEW", label: "New milestone" },
    ...milestones.map((m) => ({ value: m.id, label: `Add to: ${m.name}` })),
  ];

  const addedHours = lines.reduce((s, l) => s + (Number(l.hours) || 0), 0);
  const addedValue = lines.reduce((s, l) => s + (Number(l.hours) || 0) * (Number(l.price) || 0), 0);

  function setLine(i: number, patch: Partial<AmendmentDraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function submit() {
    const cleaned = lines
      .map((l) => ({
        name: l.name.trim(),
        quantityHours: Number(l.hours),
        unitPrice: Number(l.price),
        billable: l.billable,
        target: l.target,
      }))
      .filter((l) => l.name || l.quantityHours || l.unitPrice);
    if (cleaned.length === 0) return toast.error("Add at least one amendment line.");
    for (const l of cleaned) {
      if (!l.name) return toast.error("Every line needs a name.");
      if (!(l.quantityHours > 0)) return toast.error(`“${l.name}” needs hours greater than 0.`);
      if (!(l.unitPrice >= 0)) return toast.error(`“${l.name}” has an invalid rate.`);
    }
    start(async () => {
      const res = await createAmendmentAction({
        opportunityId,
        reference: reference.trim() || undefined,
        poNumber: poNumber.trim() || undefined,
        signedDate: signedDate || undefined,
        note: note.trim() || undefined,
        lines: cleaned,
      });
      if (res.error) toast.error(res.error);
      else {
        toast.success("Amendment applied.");
        onSaved();
      }
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Add amendment</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 overflow-y-auto flex-1 min-h-0 pr-1">
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="amd-ref">Reference</Label>
              <Input id="amd-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="AMD-2" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="amd-po">PO number</Label>
              <Input id="amd-po" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="optional" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="amd-date">Signed date</Label>
              <Input id="amd-date" type="date" value={signedDate} onChange={(e) => setSignedDate(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Lines</Label>
              <Button size="sm" variant="outline" onClick={() => setLines((p) => [...p, emptyLine()])} disabled={pending}>
                <PlusIcon /> Add line
              </Button>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end border rounded-md p-2">
                <div className="col-span-4 flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">Name</Label>
                  <Input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} placeholder="e.g. Extra dev hours" />
                </div>
                <div className="col-span-2 flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">Hours</Label>
                  <Input type="number" step="0.5" min="0" value={l.hours} onChange={(e) => setLine(i, { hours: e.target.value })} />
                </div>
                <div className="col-span-2 flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">{rateLabel}</Label>
                  <Input type="number" step="0.0001" min="0" value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} />
                </div>
                <div className="col-span-3 flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">Lands on</Label>
                  <Select value={l.target} items={targetItems} onValueChange={(v) => setLine(i, { target: v ?? "NEW" })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {targetItems.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-1 flex justify-end">
                  {lines.length > 1 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
                      disabled={pending}
                      aria-label="Remove line"
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="amd-note">Note</Label>
            <Textarea id="amd-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="optional" />
          </div>

          <div className="flex justify-end gap-6 text-sm border-t pt-3">
            <span className="text-muted-foreground">Adds</span>
            <span className="tabular-nums font-medium">
              +{formatNumber(addedHours)}h · +{formatMoney(addedValue, currency)}
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Applying…" : "Apply amendment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Line add/edit ----------
function LineDialog({
  opportunityId,
  state,
  onClose,
  onSaved,
}: {
  opportunityId: string;
  state: { mode: "add" } | { mode: "edit"; line: QuoteLineDTO };
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = state.mode === "edit" ? state.line : null;
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [hours, setHours] = useState(existing ? String(existing.quantityHours) : "");
  const [price, setPrice] = useState(existing ? String(existing.unitPrice) : "");
  const [billable, setBillable] = useState(existing?.billable ?? true);

  function submit() {
    if (!name.trim()) return toast.error("Enter a line name.");
    if (hours === "" || Number(hours) < 0) return toast.error("Enter valid hours.");
    if (price === "" || Number(price) < 0) return toast.error("Enter a valid unit price.");
    startTransition(async () => {
      const base = {
        opportunityId,
        name: name.trim(),
        description: description.trim() || null,
        quantityHours: Number(hours),
        unitPrice: Number(price),
        billable,
      };
      const res = existing ? await updateLineAction({ ...base, lineId: existing.id }) : await addLineAction(base);
      if (res.error) toast.error(res.error);
      else {
        toast.success(existing ? "Line updated." : "Line added.");
        onSaved();
      }
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit line" : "Add quote line"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="line-name">Role / workstream</Label>
            <Input id="line-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="e.g. Senior ABAP Developer" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="line-desc">Description (optional)</Label>
            <Textarea id="line-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="line-hours">Hours</Label>
              <Input id="line-hours" type="number" step="0.5" min="0" value={hours} onChange={(e) => setHours(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="line-price">Unit price</Label>
              <Input id="line-price" type="number" step="0.0001" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input id="line-billable" type="checkbox" className="size-4" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
            <Label htmlFor="line-billable">Billable</Label>
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" onClick={submit} disabled={pending}>
            {pending ? "Saving..." : existing ? "Save line" : "Add line"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Issue proposal ----------
function ProposalDialog({ opportunityId, onClose, onSaved }: { opportunityId: string; onClose: () => void; onSaved: () => void }) {
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  function submit() {
    startTransition(async () => {
      const res = await issueProposalAction({ opportunityId, label: label.trim() || undefined, note: note.trim() || undefined });
      if (res.error) toast.error(res.error);
      else {
        toast.success("Proposal snapshot saved.");
        onSaved();
      }
    });
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Issue proposal</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Snapshots the current quote (lines + discount + totals) as a numbered proposal for the negotiation trail.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prop-label">Label (optional)</Label>
            <Input id="prop-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="e.g. Initial proposal / After 10% discount" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prop-note">Note (optional)</Label>
            <Textarea id="prop-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" onClick={submit} disabled={pending}>
            {pending ? "Saving..." : "Issue proposal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Mark lost ----------
function LostDialog({ opportunityId, onClose, onSaved }: { opportunityId: string; onClose: () => void; onSaved: () => void }) {
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  function submit() {
    startTransition(async () => {
      const res = await markLostAction({ opportunityId, lostReason: reason.trim() || undefined });
      if (res.error) toast.error(res.error);
      else {
        toast.success("Marked lost.");
        onSaved();
      }
    });
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark opportunity lost</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lost-reason">Reason (optional)</Label>
          <Textarea id="lost-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
        </div>
        <DialogFooter>
          <Button size="sm" variant="destructive" onClick={submit} disabled={pending}>
            {pending ? "Saving..." : "Mark lost"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Admin decision ----------
function DecisionDialog({
  detail,
  onClose,
  onApproved,
  onRejected,
}: {
  detail: OpportunityDetail;
  onClose: () => void;
  onApproved: (projectId: string) => void;
  onRejected: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [comment, setComment] = useState("");
  function decide(decision: "APPROVE" | "REJECT") {
    startTransition(async () => {
      const res = await decideOpportunityAction({ opportunityId: detail.id, decision, comment: comment.trim() || undefined });
      if (res.error) toast.error(res.error);
      else if (decision === "APPROVE" && res.projectId) {
        toast.success("Approved — project created.");
        onApproved(res.projectId);
      } else {
        toast.success("Sent back to negotiation.");
        onRejected();
      }
    });
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review opportunity</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            <span className="font-medium">{detail.name}</span> — {detail.clientName}
          </p>
          <div className="rounded-lg border p-3 text-sm flex flex-col gap-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">List total</span>
              <span className="tabular-nums">{formatMoney(detail.gross, detail.currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Discount</span>
              <span className="tabular-nums text-amber-500">−{formatMoney(detail.discountAmount, detail.currency)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Contract value</span>
              <span className="tabular-nums">{formatMoney(detail.net, detail.currency)}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Approving creates a {detail.billingType.replaceAll("_", " ")} project with {detail.lines.length} milestone(s),
            carrying the list rates, the discount, and the SoW/PO onto the project.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="decide-comment">Comment (optional)</Label>
            <Textarea id="decide-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={500} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button size="sm" variant="destructive" onClick={() => decide("REJECT")} disabled={pending}>
            Reject
          </Button>
          <Button size="sm" onClick={() => decide("APPROVE")} disabled={pending}>
            {pending ? "Working..." : "Approve & create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Edit details (header + discount + SoW/PO) ----------
function EditDetailsDialog({
  detail,
  clients,
  contacts,
  owners,
  onClose,
  onSaved,
}: {
  detail: OpportunityDetail;
  clients: Option[];
  contacts: ContactOption[];
  owners: Option[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(detail.name);
  const [clientId, setClientId] = useState(detail.clientId);
  const [contactId, setContactId] = useState(detail.contactId ?? "NONE");
  const [billingType, setBillingType] = useState<ProjectBillingType>(detail.billingType);
  const [currency, setCurrency] = useState(detail.currency);
  const [reference, setReference] = useState(detail.reference ?? "");
  const [expectedCloseDate, setExpectedCloseDate] = useState(detail.expectedCloseDate ?? "");
  const [probability, setProbability] = useState(detail.probability != null ? String(detail.probability) : "");
  const [ownerId, setOwnerId] = useState(detail.ownerId);
  const [discountKind, setDiscountKind] = useState<"NONE" | DiscountType>(detail.discountType ?? "NONE");
  const [discountValue, setDiscountValue] = useState(detail.discountValue != null ? String(detail.discountValue) : "");
  const [sowNumber, setSowNumber] = useState(detail.sowNumber ?? "");
  const [sowSignedDate, setSowSignedDate] = useState(detail.sowSignedDate ?? "");
  const [poNumber, setPoNumber] = useState(detail.poNumber ?? "");
  const [poAmount, setPoAmount] = useState(detail.poAmount != null ? String(detail.poAmount) : "");
  const [poDate, setPoDate] = useState(detail.poDate ?? "");

  const clientContacts = useMemo(() => contacts.filter((ct) => ct.clientId === clientId), [contacts, clientId]);

  function submit() {
    if (!name.trim()) return toast.error("Enter a name.");
    startTransition(async () => {
      const res = await updateOpportunityAction({
        opportunityId: detail.id,
        name: name.trim(),
        clientId,
        contactId: contactId === "NONE" ? null : contactId,
        billingType,
        currency: currency.trim() || "USD",
        reference: reference.trim() || null,
        expectedCloseDate: expectedCloseDate || null,
        probability: probability === "" ? null : Number(probability),
        ownerId,
        discountType: discountKind === "NONE" ? null : discountKind,
        discountValue: discountKind === "NONE" || discountValue === "" ? null : Number(discountValue),
        sowNumber: sowNumber.trim() || null,
        sowSignedDate: sowSignedDate || null,
        poNumber: poNumber.trim() || null,
        poAmount: poAmount === "" ? null : Number(poAmount),
        poDate: poDate || null,
      });
      if (res.error) toast.error(res.error);
      else {
        toast.success("Saved.");
        onSaved();
      }
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Edit opportunity</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-name">Name</Label>
              <Input id="ed-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-client">Client</Label>
              <Select
                value={clientId}
                items={clients.map((cl) => ({ value: cl.id, label: cl.name }))}
                onValueChange={(v) => {
                  setClientId(v ?? clientId);
                  setContactId("NONE");
                }}
              >
                <SelectTrigger id="ed-client" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((cl) => (
                    <SelectItem key={cl.id} value={cl.id}>
                      {cl.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-contact">Contact</Label>
              <Select
                value={contactId}
                items={[{ value: "NONE", label: "— none —" }, ...clientContacts.map((ct) => ({ value: ct.id, label: ct.name }))]}
                onValueChange={(v) => setContactId(v ?? "NONE")}
              >
                <SelectTrigger id="ed-contact" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">— none —</SelectItem>
                  {clientContacts.map((ct) => (
                    <SelectItem key={ct.id} value={ct.id}>
                      {ct.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-owner">Owner</Label>
              <Select value={ownerId} items={owners.map((o) => ({ value: o.id, label: o.name }))} onValueChange={(v) => setOwnerId(v ?? ownerId)}>
                <SelectTrigger id="ed-owner" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {owners.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-billing">Billing type</Label>
              <Select value={billingType} items={BILLING_TYPES.map((t) => ({ value: t, label: t.replaceAll("_", " ") }))} onValueChange={(v) => setBillingType((v as ProjectBillingType) ?? billingType)}>
                <SelectTrigger id="ed-billing" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replaceAll("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-currency">Currency</Label>
              <Input id="ed-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={10} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-ref">Reference</Label>
              <Input id="ed-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-close">Expected close</Label>
              <Input id="ed-close" type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-prob">Win probability %</Label>
              <Input id="ed-prob" type="number" min="0" max="100" step="5" value={probability} onChange={(e) => setProbability(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-disc-kind">Discount</Label>
              <Select
                value={discountKind}
                items={[
                  { value: "NONE", label: "No discount" },
                  { value: "PERCENT", label: "Percentage (%)" },
                  { value: "ABSOLUTE", label: "Fixed amount" },
                ]}
                onValueChange={(v) => setDiscountKind((v as "NONE" | DiscountType) ?? "NONE")}
              >
                <SelectTrigger id="ed-disc-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">No discount</SelectItem>
                  <SelectItem value="PERCENT">Percentage (%)</SelectItem>
                  <SelectItem value="ABSOLUTE">Fixed amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-disc-val">Discount value</Label>
              <Input
                id="ed-disc-val"
                type="number"
                min="0"
                step="0.01"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                disabled={discountKind === "NONE"}
              />
            </div>
          </div>
          <div className="border-t pt-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">SoW & Purchase Order</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-sow">SoW number</Label>
              <Input id="ed-sow" value={sowNumber} onChange={(e) => setSowNumber(e.target.value)} maxLength={100} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-sowdate">SoW signed date</Label>
              <Input id="ed-sowdate" type="date" value={sowSignedDate} onChange={(e) => setSowSignedDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-po">PO number</Label>
              <Input id="ed-po" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} maxLength={100} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-poamt">PO amount</Label>
              <Input id="ed-poamt" type="number" min="0" step="0.01" value={poAmount} onChange={(e) => setPoAmount(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ed-podate">PO date</Label>
              <Input id="ed-podate" type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" onClick={submit} disabled={pending}>
            {pending ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
