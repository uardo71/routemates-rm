"use client";

import * as React from "react";
import Link from "next/link";
import {
  TrendingUpIcon, ScaleIcon, BanknoteIcon, TargetIcon, ReceiptIcon, CoinsIcon,
  ChevronRightIcon, ArrowRightIcon, SearchIcon, AlertTriangleIcon, ClockIcon, CheckCircle2Icon, ExternalLinkIcon,
  CalendarIcon, Building2Icon, FolderIcon, FileTextIcon, FlagIcon,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InitialsAvatar } from "@/components/initials-avatar";
import { MiniBarChart } from "@/components/charts/mini-bar-chart";
import { formatMoney } from "@/lib/format";
import { INVOICE_STATUS_LABEL } from "@/lib/invoice";
import { cn } from "@/lib/utils";
import type { MilestoneStatus } from "@prisma/client";
import type { CommandCenter, CmdRag, CmdClient, CmdProject, CmdAttention, UnbilledBreakdown, UnbilledMilestone } from "@/lib/command-center";

const MS_STATUS_LABEL: Record<MilestoneStatus, string> = { PLANNED: "Planned", ACTIVE: "Active", COMPLETE: "Complete", INVOICED: "Invoiced" };
const MS_STATUS_TONE: Record<MilestoneStatus, string> = {
  PLANNED: "bg-muted text-muted-foreground",
  ACTIVE: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  COMPLETE: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  INVOICED: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
};

const BILLING_LABEL: Record<string, string> = { TIME_AND_MATERIALS: "T&M", FIXED_PRICE: "Fixed", RETAINER: "Retainer" };
const RAG_DOT: Record<CmdRag, string> = { GREEN: "bg-emerald-500", AMBER: "bg-amber-500", RED: "bg-rose-500", NONE: "bg-muted-foreground/30" };
const RAG_WORD: Record<CmdRag, string> = { GREEN: "On track", AMBER: "At risk", RED: "Off track", NONE: "No status" };
const KIND_ICON: Record<string, LucideIcon> = {
  unbilled: ReceiptIcon,
  overbudget: ClockIcon,
  lowmargin: ScaleIcon,
  overdue: AlertTriangleIcon,
  reconcile: FileTextIcon,
};

export function CommandCenterClient({ data, periodLabel }: { data: CommandCenter; periodLabel: string }) {
  const c = data.currency;
  const k = data.kpis;
  const money = (n: number) => formatMoney(n, c);
  const compact = (n: number) => {
    const abs = Math.abs(n);
    if (abs >= 1000) return `${n < 0 ? "-" : ""}${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
    return `${Math.round(n)}`;
  };
  const sym = money(0).replace(/[\d.,\s]/g, "");
  const mc = (n: number) => `${n < 0 ? "-" : ""}${sym}${compact(n)}`;

  const attnCount = data.attention.length;

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Command center</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Where the business stands — every figure drills to the detail.</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarIcon className="size-4" />
          <span className="font-mono">{periodLabel}</span>
        </div>
      </div>

      {/* FINANCIAL POSITION */}
      <section className="flex flex-col gap-3">
        <SectionHeader title="Financial position" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <HeroKpi href="/revenue" icon={TrendingUpIcon} label="Earned revenue" value={mc(k.earned)} sub={`${mc(k.forecast)} forecast`} />
          <HeroKpi
            href="/revenue"
            icon={ScaleIcon}
            label="Gross margin"
            value={k.marginPct != null ? `${k.marginPct}%` : "—"}
            sub={`${mc(k.margin)} · op. ${mc(k.operatingMargin)}`}
            tone={k.marginPct != null && k.marginPct < 15 ? "warn" : "good"}
          />
          <HeroKpi
            href="/invoices"
            icon={BanknoteIcon}
            label="Cash outstanding"
            value={mc(k.outstanding)}
            sub={k.overdueAmount > 0 ? `${mc(k.overdueAmount)} overdue` : "none overdue"}
            tone={k.overdueAmount > 0 ? "warn" : "default"}
          />
          <HeroKpi href="/opportunities" icon={TargetIcon} label="Pipeline" value={mc(k.pipeline)} sub="open deals" />
        </div>
        {/* secondary stats strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat href="/invoices" icon={ReceiptIcon} label="Invoiced" value={mc(k.recognized)} sub={`${mc(k.collected)} collected`} />
          <MiniStat href="/revenue" icon={CoinsIcon} label="Cost to date" value={mc(k.cost)} />
          <MiniStat href="/revenue" icon={Building2Icon} label="Overhead" value={mc(k.overheadCost)} />
          <MiniStat href="/projects" icon={FolderIcon} label="Active work" value={`${k.activeProjects}`} sub={`${k.clientsCount} clients`} />
        </div>
      </section>

      {/* DELIVERY + FORECAST */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <SectionHeader
            title="Delivery health"
            action={<Link href="/delivery?view=workspaces" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary">Open cockpit <ArrowRightIcon className="size-3" /></Link>}
          />
          <Card className="flex-1">
            <CardContent className="flex flex-col justify-center gap-4 py-5">
              <HealthBar counts={data.ragCounts} />
            </CardContent>
          </Card>
        </div>
        <div className="flex flex-col gap-3">
          <SectionHeader
            title="Forecast by quarter"
            action={<Link href="/revenue" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary">Revenue report <ArrowRightIcon className="size-3" /></Link>}
          />
          <Card className="flex-1">
            <CardContent className="flex flex-col justify-center gap-2 py-5">
              {data.quarterly.some((v) => v > 0) ? (
                <MiniBarChart data={data.quarterLabels.map((label, i) => ({ label, value: data.quarterly[i] ?? 0 }))} height={96} valueFormatter={(v) => mc(v)} />
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">No planned revenue in the next four quarters.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* NEEDS ATTENTION */}
      {attnCount > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader title="Needs your attention" count={attnCount} />
          <Attention items={data.attention} money={mc} moneyFull={money} />
        </section>
      )}

      {/* PORTFOLIO */}
      <section className="flex flex-col gap-3">
        <SectionHeader title="Portfolio" />
        <ClientTable clients={data.clients} mc={mc} moneyFull={money} />
      </section>
    </div>
  );
}

function SectionHeader({ title, count, action }: { title: string; count?: number; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h2>
      {count != null && <span className="rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold text-primary tabular-nums">{count}</span>}
      <span className="h-px flex-1 bg-border" />
      {action}
    </div>
  );
}

function HeroKpi({ href, icon: Icon, label, value, sub, tone = "default" }: { href: string; icon: LucideIcon; label: string; value: string; sub?: string; tone?: "default" | "good" | "warn" | "bad" }) {
  return (
    <Link href={href} className="group">
      <Card className="h-full transition-all group-hover:border-primary/40 group-hover:shadow-sm">
        <CardContent className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
            <Icon className="size-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={cn("mt-0.5 text-2xl font-semibold tabular-nums leading-tight", tone === "warn" && "text-amber-600 dark:text-amber-400", tone === "bad" && "text-rose-600 dark:text-rose-400")}>{value}</div>
            {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function MiniStat({ href, icon: Icon, label, value, sub }: { href: string; icon: LucideIcon; label: string; value: string; sub?: string }) {
  return (
    <Link href={href} className="group flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-muted/30">
      <Icon className="size-4 shrink-0 text-muted-foreground/70 group-hover:text-primary" />
      <div className="min-w-0">
        <div className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate font-mono text-sm font-semibold tabular-nums">
          {value}
          {sub && <span className="ml-1.5 font-sans text-[0.625rem] font-normal text-muted-foreground">{sub}</span>}
        </div>
      </div>
    </Link>
  );
}

function HealthBar({ counts }: { counts: { GREEN: number; AMBER: number; RED: number; NONE: number } }) {
  const order: CmdRag[] = ["RED", "AMBER", "GREEN", "NONE"];
  const total = counts.GREEN + counts.AMBER + counts.RED + counts.NONE;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {total === 0 ? null : order.map((rag) => {
          const n = counts[rag];
          if (n === 0) return null;
          return <div key={rag} className={cn("h-full", RAG_DOT[rag])} style={{ width: `${(n / total) * 100}%` }} title={`${n} ${RAG_WORD[rag]}`} />;
        })}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {order.map((rag) => (
          <div key={rag} className={cn("flex items-center gap-2", counts[rag] === 0 && "opacity-45")}>
            <span className={cn("size-2.5 shrink-0 rounded-full", RAG_DOT[rag])} />
            <span className="text-lg font-semibold tabular-nums">{counts[rag]}</span>
            <span className="text-xs text-muted-foreground">{RAG_WORD[rag]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Attention({ items, money, moneyFull }: { items: CmdAttention[]; money: (n: number) => string; moneyFull: (n: number) => string }) {
  const [showAll, setShowAll] = React.useState(false);
  const [drill, setDrill] = React.useState<UnbilledBreakdown | null>(null);
  const shown = showAll ? items : items.slice(0, 6);

  const rowInner = (a: CmdAttention) => {
    const KindIcon = KIND_ICON[a.kind] ?? AlertTriangleIcon;
    return (
      <>
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", a.severity === "high" ? "bg-rose-500/12 text-rose-600 dark:text-rose-400" : "bg-amber-500/12 text-amber-600 dark:text-amber-400")}>
          <KindIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{a.title}</div>
          <div className="truncate text-xs text-muted-foreground">{a.detail}</div>
        </div>
        {a.amount != null && <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">{money(a.amount)}</span>}
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/50 group-hover:text-primary" />
      </>
    );
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-0.5">
        {shown.map((a) =>
          a.breakdown ? (
            <button key={a.id} onClick={() => setDrill(a.breakdown!)} className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted/50">
              {rowInner(a)}
            </button>
          ) : (
            <Link key={a.id} href={a.href} className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
              {rowInner(a)}
            </Link>
          ),
        )}
        {items.length > 6 && (
          <button onClick={() => setShowAll((v) => !v)} className="mt-1 self-start text-xs font-medium text-primary hover:underline">
            {showAll ? "Show less" : `Show all ${items.length}`}
          </button>
        )}
      </CardContent>
      {drill && <UnbilledDialog b={drill} money={moneyFull} onClose={() => setDrill(null)} />}
    </Card>
  );
}

function UnbilledDialog({ b, money, onClose }: { b: UnbilledBreakdown; money: (n: number) => string; onClose: () => void }) {
  const billedMs = b.milestones.filter((m) => m.billed);
  return (
    <Dialog open disablePointerDismissal onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] flex flex-col overflow-hidden gap-0 p-0">
        <DialogHeader className="border-b p-4">
          <DialogTitle>Work delivered but not invoiced</DialogTitle>
          <p className="text-xs text-muted-foreground">{b.projectName} · {b.clientName} · {BILLING_LABEL[b.billingType] ?? b.billingType}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Figure label="Delivered (earned)" value={money(b.earned)} />
            <Figure label="Already invoiced" value={money(b.billed)} />
            <Figure label="Still to bill" value={money(b.unbilled)} accent />
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <p className="mb-4 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            You&apos;ve delivered <strong className="text-foreground">{money(b.earned)}</strong> of value; <strong className="text-foreground">{money(b.billed)}</strong> has
            been invoiced (commission excluded). That leaves <strong className="text-foreground">{money(b.unbilled)}</strong> of delivered work not yet on an invoice.
          </p>

          <SectionLabel>Delivered work {b.milestones.length > 0 && <span className="text-muted-foreground">({b.milestones.length})</span>}</SectionLabel>
          {b.milestones.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No completed milestones or approved hours yet — the earned value is 0.</p>
          ) : (
            <div className="mb-4 overflow-hidden rounded-md border">
              {b.milestones.map((m) => (
                <MilestoneRow key={m.milestoneId} m={m} projectId={b.projectId} money={money} />
              ))}
            </div>
          )}

          <SectionLabel>
            Already invoiced {b.invoices.length > 0 && <span className="text-muted-foreground">({b.invoices.length})</span>}
            {billedMs.length > 0 && <span className="ml-1 text-muted-foreground">· some milestones above are covered by these</span>}
          </SectionLabel>
          {b.invoices.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">Nothing invoiced on this project yet.</p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              {b.invoices.map((inv) => (
                <Link key={inv.invoiceId} href={`/invoices/${inv.invoiceId}`} className="group grid grid-cols-[1fr_auto] items-center gap-3 border-b px-3 py-2 last:border-none hover:bg-muted/40 sm:grid-cols-[auto_1fr_auto_auto]">
                  <span className="font-mono text-sm">{inv.invoiceNumber}</span>
                  <span className="text-xs text-muted-foreground max-sm:hidden">{inv.date}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{INVOICE_STATUS_LABEL[inv.status]}</span>
                  <span className="w-24 text-right font-mono text-sm tabular-nums">{money(inv.work)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t p-3">
          <Link href={`/projects/${b.projectId}?tab=milestones`} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:border-primary/50 hover:text-primary">
            Open project
          </Link>
          <Link href="/invoices/new" className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:bg-foreground/90">
            <ReceiptIcon className="size-4" /> Create invoice
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MilestoneRow({ m, projectId, money }: { m: UnbilledMilestone; projectId: string; money: (n: number) => string }) {
  const [open, setOpen] = React.useState(false);
  const hasCards = m.cards.length > 0;
  const expandable = hasCards || m.basis === "complete";
  return (
    <div className="border-b last:border-none">
      <div className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <button
          type="button"
          onClick={() => expandable && setOpen((o) => !o)}
          className={cn("flex min-w-0 items-center gap-2 text-left", expandable ? "cursor-pointer" : "cursor-default")}
        >
          {expandable ? (
            <ChevronRightIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <span className="truncate text-sm">{m.name}</span>
          {m.billed && m.basis === "hours" && <span className="shrink-0 rounded bg-violet-500/15 px-1.5 text-[10px] text-violet-700 dark:text-violet-400">partly invoiced</span>}
        </button>
        <span className={cn("hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline", MS_STATUS_TONE[m.status])}>{MS_STATUS_LABEL[m.status]}</span>
        <span className="hidden w-24 text-right font-mono text-xs text-muted-foreground tabular-nums sm:inline">{m.basis === "hours" ? `${Math.round(m.unbilledHours)}h` : "—"}</span>
        <span className="w-20 text-right font-mono text-sm tabular-nums">{money(m.unbilled)}</span>
      </div>
      {open && (
        <div className="border-t border-border/50 bg-muted/30 px-3 py-2">
          {m.basis === "complete" && (
            <p className="mb-2 flex items-start gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2Icon className="mt-px size-3.5 shrink-0" />
              Milestone marked <strong>complete</strong> — the full fixed-price value is due for invoicing, regardless of hours logged.
            </p>
          )}
          {m.basis === "hours" && (
            <p className="mb-2 text-xs text-muted-foreground">
              <span className="font-mono text-foreground">{money(m.earned)}</span> earned ·{" "}
              <span className="font-mono">{money(m.earned - m.unbilled)}</span> already invoiced ·{" "}
              <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">{money(m.unbilled)}</span> still to bill
            </p>
          )}
          {hasCards ? (
            <>
              <div className="mb-1 text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                Unbilled time cards ({m.cards.length})
              </div>
              <div className="flex flex-col">
                {m.cards.map((c) => (
                  <Link
                    key={c.cardId}
                    href={`/time-cards/${encodeURIComponent(c.cardId)}`}
                    target="_blank"
                    title="Open the time card — unbilled days highlighted"
                    className="group -mx-1 grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded px-1 py-1 text-xs hover:bg-muted/60"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <ClockIcon className="size-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{c.user}</span>
                      <span className="shrink-0 text-muted-foreground">· wk {c.week}</span>
                      <ExternalLinkIcon className="size-3 shrink-0 text-transparent group-hover:text-primary" />
                    </span>
                    <span className="w-16 text-right font-mono tabular-nums text-muted-foreground">{c.hours}h</span>
                    <span className="w-20 text-right font-mono tabular-nums">{c.value != null ? money(c.value) : "—"}</span>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            m.basis !== "complete" && <p className="text-xs text-muted-foreground">No approved time cards on this milestone yet.</p>
          )}
          <Link href={`/projects/${projectId}?tab=milestones`} className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
            Open milestone <ArrowRightIcon className="size-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-md border px-3 py-1.5", accent && "border-amber-500/40 bg-amber-500/5")}>
      <div className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("font-mono text-sm font-semibold tabular-nums", accent && "text-amber-600 dark:text-amber-400")}>{value}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{children}</div>;
}

type Lens = "finance" | "delivery";

const RAG_PILL: Record<CmdRag, string> = {
  RED: "bg-rose-500/12 text-rose-700 dark:text-rose-400",
  AMBER: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
  GREEN: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
  NONE: "bg-muted text-muted-foreground",
};

function marginTone(p: number | null) {
  if (p == null) return "text-muted-foreground";
  if (p < 0) return "text-rose-600 dark:text-rose-400";
  if (p < 15) return "text-amber-600 dark:text-amber-400";
  return "text-foreground";
}
// Status-age → chip text + chip classes (border/bg/text). Sparse delivery data (no report yet) reads
// as a deliberate muted chip rather than an empty cell.
function statusChip(days: number | null): { text: string; cls: string } {
  const muted = "border-border bg-muted/40 text-muted-foreground";
  if (days == null) return { text: "No report", cls: muted };
  if (days <= 0) return { text: "Reported today", cls: "border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-400" };
  const text = `${days}d ago`;
  if (days > 30) return { text, cls: "border-rose-500/30 bg-rose-500/8 text-rose-700 dark:text-rose-400" };
  if (days > 14) return { text, cls: "border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-400" };
  return { text, cls: muted };
}
const AMBER_CHIP = "border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-400";

function Chip({ icon: Icon, className, children }: { icon: LucideIcon; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs", className)}>
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  );
}

function RagPill({ rag }: { rag: CmdRag }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", RAG_PILL[rag])}>
      <span className={cn("size-1.5 rounded-full", RAG_DOT[rag])} />
      {RAG_WORD[rag]}
    </span>
  );
}

// A right-aligned metric cell. Header (client) rows show the label; body (project) rows omit it so
// the values line up neatly underneath.
function Stat({ label, value, tone, w = "w-24" }: { label?: string; value: string; tone?: string; w?: string }) {
  return (
    <div className={cn("text-right", w)}>
      {label && <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>}
      <div className={cn("font-mono text-sm font-semibold tabular-nums", tone ?? "text-foreground")}>{value}</div>
    </div>
  );
}

function ClientTable({ clients, mc, moneyFull }: { clients: CmdClient[]; mc: (n: number) => string; moneyFull: (n: number) => string }) {
  const [q, setQ] = React.useState("");
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [lens, setLens] = React.useState<Lens>("finance");
  const needle = q.trim().toLowerCase();

  const filtered = clients
    .map((cl) => {
      if (!needle) return cl;
      if (cl.clientName.toLowerCase().includes(needle)) return cl;
      const ps = cl.projects.filter((p) => p.name.toLowerCase().includes(needle));
      return ps.length ? { ...cl, projects: ps } : null;
    })
    .filter(Boolean) as CmdClient[];

  function toggle(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">Clients &amp; projects</span>
            <div className="inline-flex rounded-full border bg-muted/40 p-0.5 text-xs">
              {(["finance", "delivery"] as Lens[]).map((l) => (
                <button key={l} onClick={() => setLens(l)} className={cn("rounded-full px-3 py-1 font-medium capitalize transition", lens === l ? "bg-background shadow-sm" : "text-muted-foreground")}>{l}</button>
              ))}
            </div>
          </div>
          <div className="relative w-full sm:w-64">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a client or project…" className="h-9 pl-8" />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {filtered.map((cl) => {
            const open = !(collapsed.has(cl.clientName) && !needle);
            return (
              <div key={cl.clientName} className="overflow-hidden rounded-xl border bg-card">
                {/* client header */}
                <button onClick={() => toggle(cl.clientName)} className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/40">
                  <ChevronRightIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
                  <InitialsAvatar name={cl.clientName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">{cl.clientName}</span>
                      <RagPill rag={cl.rag} />
                    </div>
                    <div className="text-xs text-muted-foreground">{cl.projects.length} project{cl.projects.length === 1 ? "" : "s"}</div>
                  </div>
                  {lens === "finance" ? (
                    <div className="hidden items-center gap-5 pr-1 sm:flex">
                      <Stat label="Earned" value={mc(cl.earned)} />
                      <Stat label="Margin" value={cl.marginPct != null ? `${cl.marginPct}%` : "—"} tone={marginTone(cl.marginPct)} w="w-16" />
                      <Stat label="Outstanding" value={cl.outstanding > 0 ? mc(cl.outstanding) : "—"} tone="text-muted-foreground" />
                      <Stat label="Unbilled" value={cl.unbilled > 0 ? mc(cl.unbilled) : "—"} tone={cl.unbilled > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"} />
                    </div>
                  ) : (
                    (() => {
                      const noReport = cl.projects.filter((p) => p.lastStatusDays == null).length;
                      const clean = cl.openIssues === 0 && noReport === 0;
                      return (
                        <div className="hidden shrink-0 items-center gap-2 pr-1 sm:flex">
                          {cl.openIssues > 0 && <Chip icon={AlertTriangleIcon} className={AMBER_CHIP}>{cl.openIssues} open</Chip>}
                          {noReport > 0 && <Chip icon={ClockIcon} className="border-border bg-muted/40 text-muted-foreground">{noReport} no report</Chip>}
                          {clean && <span className="text-xs text-emerald-600 dark:text-emerald-400">All reported</span>}
                        </div>
                      );
                    })()
                  )}
                </button>
                {open && (
                  <div className="divide-y border-t">
                    {cl.projects.map((p) => (
                      <ProjectRow key={p.projectId} p={p} lens={lens} mc={mc} moneyFull={moneyFull} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">No match.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectRow({ p, lens, mc, moneyFull }: { p: CmdProject; lens: Lens; mc: (n: number) => string; moneyFull: (n: number) => string }) {
  const status = statusChip(p.lastStatusDays);
  return (
    <Link
      href={`/projects/${p.projectId}`}
      title={`${moneyFull(p.earned)} earned · ${moneyFull(p.margin)} margin · ${moneyFull(p.outstanding)} outstanding · ${moneyFull(p.unbilled)} unbilled`}
      className="group flex items-center gap-3 px-3 py-2.5 pl-11 transition-colors hover:bg-muted/40"
    >
      <span className={cn("size-2 shrink-0 rounded-full", RAG_DOT[p.rag])} />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm">{p.name}</span>
        <span className="shrink-0 rounded border px-1.5 text-[10px] text-muted-foreground">{BILLING_LABEL[p.billingType] ?? p.billingType}</span>
        <ArrowRightIcon className="size-3 shrink-0 text-transparent transition-colors group-hover:text-primary" />
      </div>
      {lens === "finance" ? (
        <div className="hidden items-center gap-5 pr-1 sm:flex">
          <Stat value={mc(p.earned)} />
          <Stat value={p.marginPct != null ? `${p.marginPct}%` : "—"} tone={marginTone(p.marginPct)} w="w-16" />
          <Stat value={p.outstanding > 0 ? mc(p.outstanding) : "—"} tone="text-muted-foreground" />
          <Stat value={p.unbilled > 0 ? mc(p.unbilled) : "—"} tone={p.unbilled > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"} />
        </div>
      ) : (
        <div className="hidden shrink-0 items-center justify-end gap-2 pr-1 sm:flex">
          <Chip icon={FlagIcon} className="max-w-[14rem] border-border bg-muted/40 text-muted-foreground">
            {p.nextMilestone ?? "No milestone set"}
          </Chip>
          <Chip icon={ClockIcon} className={status.cls}>{status.text}</Chip>
          {p.openIssues > 0 && <Chip icon={AlertTriangleIcon} className={AMBER_CHIP}>{p.openIssues} open</Chip>}
        </div>
      )}
    </Link>
  );
}
