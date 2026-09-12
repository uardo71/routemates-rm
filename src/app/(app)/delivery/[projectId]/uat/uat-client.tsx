"use client";

import * as React from "react";
import { BackLink } from "@/components/back-link";
import { PlusIcon, Trash2Icon, DownloadIcon, SaveIcon, Undo2Icon, BugIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  UAT_RESULTS, UAT_RESULT_LABEL, UAT_RESULT_TONE, UAT_SCRIPT_STATUSES, UAT_SCRIPT_STATUS_LABEL, rollupArea,
} from "@/lib/uat";
import type { UatResult, UatScriptStatus, UatIssueStatus } from "@prisma/client";
import type { UatData, UatAreaData, UatCaseData, UatIssueData } from "./serialize";
import { saveUatAction } from "./actions";

const newId = () => `new:${crypto.randomUUID()}`;
const autoGrow = (el: HTMLTextAreaElement | null) => { if (!el) return; el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; };
const today = () => new Date().toISOString().slice(0, 10);

const clone = (d: UatData): UatData => ({ ...d, areas: d.areas.map((a) => ({ ...a })), cases: d.cases.map((c) => ({ ...c })), issues: d.issues.map((i) => ({ ...i })) });

export function UatClient({
  scriptId, scriptName, engagementName, projectName, projectNumber, clientName, data: initial, userNames, backHref,
}: {
  scriptId: string;
  scriptName: string;
  engagementName: string | null;
  projectName: string;
  projectNumber: string | null;
  clientName: string;
  data: UatData;
  userNames: string[];
  backHref: string;
}) {
  const [d, setD] = React.useState<UatData>(() => clone(initial));
  const [base, setBase] = React.useState<UatData>(() => clone(initial));
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const mutate = (fn: (x: UatData) => UatData) => { setD((x) => fn(x)); setDirty(true); };
  const editArea = (id: string, p: Partial<UatAreaData>) => mutate((x) => ({ ...x, areas: x.areas.map((a) => (a.id === id ? { ...a, ...p } : a)) }));
  const editCase = (id: string, p: Partial<UatCaseData>) => mutate((x) => ({ ...x, cases: x.cases.map((c) => (c.id === id ? { ...c, ...p } : c)) }));
  const editIssue = (id: string, p: Partial<UatIssueData>) => mutate((x) => ({ ...x, issues: x.issues.map((i) => (i.id === id ? { ...i, ...p } : i)) }));
  const addArea = () => mutate((x) => ({ ...x, areas: [...x.areas, { id: newId(), name: "", overview: "", dataRequirements: "" }] }));
  const delArea = (id: string) => mutate((x) => ({ ...x, areas: x.areas.filter((a) => a.id !== id), cases: x.cases.filter((c) => c.areaId !== id) }));
  const addCase = (areaId: string) => mutate((x) => ({ ...x, cases: [...x.cases, { id: newId(), areaId, description: "", prerequisites: "", expectedResults: "", runBy: "", dateRun: "", result: "NOT_RUN", reasonForFailure: "", docNo: "", comments: "" }] }));
  const delCase = (id: string) => mutate((x) => ({ ...x, cases: x.cases.filter((c) => c.id !== id) }));
  const addIssue = () => mutate((x) => ({ ...x, issues: [...x.issues, { id: newId(), areaRef: "", testRef: "", type: "", description: "", correctiveAction: "", assigned: "", status: "OPEN", dateRaised: today(), dateClosed: "" }] }));
  const delIssue = (id: string) => mutate((x) => ({ ...x, issues: x.issues.filter((i) => i.id !== id) }));
  const setStatus = (s: UatScriptStatus) => mutate((x) => ({ ...x, status: s, sentAt: s === "SENT" && !x.sentAt ? today() : x.sentAt }));

  const casesOf = (areaId: string) => d.cases.filter((c) => c.areaId === areaId);
  const overall = rollupArea(d.cases.map((c) => c.result));

  async function save() {
    setSaving(true); setError(null);
    const orderedCases: UatCaseData[] = [];
    for (const a of d.areas) for (const c of casesOf(a.id)) orderedCases.push(c);
    const payload = {
      status: d.status,
      sentAt: d.sentAt || null,
      areas: d.areas.map((a) => ({ id: a.id, name: a.name, overview: a.overview, dataRequirements: a.dataRequirements })),
      cases: orderedCases.map((c) => ({ ...c, dateRun: c.dateRun || null })),
      issues: d.issues.map((i) => ({ ...i, dateRaised: i.dateRaised || null, dateClosed: i.dateClosed || null })),
    };
    const res = await saveUatAction(scriptId, payload);
    if (res.data) { setD(clone(res.data)); setBase(clone(res.data)); setDirty(false); }
    else setError(res.error ?? "Could not save.");
    setSaving(false);
  }
  function discard() { setD(clone(base)); setDirty(false); setError(null); }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <BackLink href={backHref} label="Back" />
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{scriptName}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {engagementName && <span className="font-medium text-foreground">{engagementName} · </span>}
              {projectName}{projectNumber ? ` · ${projectNumber}` : ""} · {clientName}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {dirty && <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/12 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">Unsaved changes</span>}
            <Button variant="outline" size="sm" onClick={discard} disabled={!dirty || saving} className="gap-1.5"><Undo2Icon className="size-4" /> Discard</Button>
            <Button size="sm" onClick={save} disabled={!dirty || saving} className="gap-1.5"><SaveIcon className="size-4" /> {saving ? "Saving…" : "Save"}</Button>
            <a
              href={dirty ? undefined : `/api/uat/${scriptId}/export`}
              aria-disabled={dirty}
              title={dirty ? "Save your changes first" : "Export to Excel"}
              className={cn("inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors", dirty ? "pointer-events-none opacity-50" : "hover:border-primary/50 hover:text-primary")}
            >
              <DownloadIcon className="size-4" /> Export Excel
            </a>
          </div>
        </div>
      </div>

      {error && <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

      {/* Governance + summary */}
      <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
        <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
          <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">Test script status</span>
          <div className="inline-flex w-fit rounded-full border bg-muted/40 p-0.5 text-xs">
            {UAT_SCRIPT_STATUSES.map((s) => (
              <button key={s} onClick={() => setStatus(s)} className={cn("rounded-full px-3 py-1 font-medium transition", d.status === s ? "bg-background shadow-sm" : "text-muted-foreground")}>{UAT_SCRIPT_STATUS_LABEL[s]}</button>
            ))}
          </div>
          {d.status === "SENT" && (
            <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">Sent on
              <input type="date" value={d.sentAt} onChange={(e) => mutate((x) => ({ ...x, sentAt: e.target.value }))} className="rounded-md border px-2 py-1 text-sm" />
            </label>
          )}
          <p className="text-xs text-muted-foreground">Prepared by the consultant, sent to the customer before UAT. The PM checks it reaches <strong>Sent</strong>.</p>
        </div>
        <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
          <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">Results — {d.cases.length} test case{d.cases.length === 1 ? "" : "s"} across {d.areas.length} area{d.areas.length === 1 ? "" : "s"}</span>
          <div className="flex flex-wrap gap-2">
            <Tally label="OK" n={overall.ok} tone="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" />
            <Tally label="KO" n={overall.ko} tone="bg-rose-500/15 text-rose-700 dark:text-rose-400" />
            <Tally label="Redo" n={overall.redo} tone="bg-amber-500/15 text-amber-700 dark:text-amber-400" />
            <Tally label="Not run" n={overall.notRun} tone="bg-muted text-muted-foreground" />
            <Tally label="Open issues" n={d.issues.filter((i) => i.status === "OPEN").length} tone="bg-rose-500/15 text-rose-700 dark:text-rose-400" />
          </div>
        </div>
      </div>

      {/* Functional areas */}
      <div className="flex items-center gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Functional areas &amp; test cases</h2>
        <span className="h-px flex-1 bg-border" />
        <Button variant="outline" size="sm" onClick={addArea} className="gap-1.5"><PlusIcon className="size-4" /> Add area</Button>
      </div>

      {d.areas.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">No functional areas yet. Add one (e.g. &ldquo;Company Code Determination&rdquo;), then its test cases.</div>
      ) : (
        d.areas.map((a, ai) => {
          const cs = casesOf(a.id);
          const r = rollupArea(cs.map((c) => c.result));
          return (
            <div key={a.id} className="overflow-hidden rounded-xl border bg-card">
              <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
                <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold text-primary">{ai + 1}</span>
                <input value={a.name} onChange={(e) => editArea(a.id, { name: e.target.value })} placeholder="Functional area name…" className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none" />
                <div className="flex shrink-0 items-center gap-1.5 text-xs">
                  <Chip tone="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">OK {r.ok}</Chip>
                  <Chip tone="bg-rose-500/15 text-rose-700 dark:text-rose-400">KO {r.ko}</Chip>
                  <Chip tone="bg-amber-500/15 text-amber-700 dark:text-amber-400">Redo {r.redo}</Chip>
                  <span className="text-muted-foreground">/ {r.total}</span>
                </div>
                <button type="button" onClick={() => delArea(a.id)} title="Delete area" className="shrink-0 text-muted-foreground/40 hover:text-destructive"><Trash2Icon className="size-4" /></button>
              </div>
              <div className="grid gap-3 border-b px-3 py-2.5 sm:grid-cols-2">
                <label className="flex flex-col gap-1"><span className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">Overview</span>
                  <textarea rows={2} ref={(el) => autoGrow(el)} onInput={(e) => autoGrow(e.currentTarget)} value={a.overview} onChange={(e) => editArea(a.id, { overview: e.target.value })} placeholder="What this area validates…" className="resize-none rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-muted/30" />
                </label>
                <label className="flex flex-col gap-1"><span className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">Data requirements / prerequisites</span>
                  <textarea rows={2} ref={(el) => autoGrow(el)} onInput={(e) => autoGrow(e.currentTarget)} value={a.dataRequirements} onChange={(e) => editArea(a.id, { dataRequirements: e.target.value })} placeholder="Data / config needed to run these…" className="resize-none rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-muted/30" />
                </label>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1200px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                      <th className="w-10 px-2 py-2 font-medium">#</th>
                      <th className="min-w-56 px-2 py-2 font-medium">Description</th>
                      <th className="min-w-44 px-2 py-2 font-medium">Prerequisites</th>
                      <th className="min-w-56 px-2 py-2 font-medium">Expected results</th>
                      <th className="w-28 px-2 py-2 font-medium">Run by</th>
                      <th className="w-32 px-2 py-2 font-medium">Date run</th>
                      <th className="w-28 px-2 py-2 font-medium">Result</th>
                      <th className="min-w-44 px-2 py-2 font-medium">Reason for failure</th>
                      <th className="w-24 px-2 py-2 font-medium">Doc no</th>
                      <th className="min-w-44 px-2 py-2 font-medium">Comments</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {cs.map((c, ci) => (
                      <tr key={c.id} className="group border-b align-top last:border-none hover:bg-muted/20">
                        <td className="px-2 py-2 text-center font-mono text-xs text-muted-foreground tabular-nums">{ci + 1}</td>
                        <td className="border-l"><TA value={c.description} onChange={(v) => editCase(c.id, { description: v })} /></td>
                        <td className="border-l"><TA value={c.prerequisites} onChange={(v) => editCase(c.id, { prerequisites: v })} /></td>
                        <td className="border-l"><TA value={c.expectedResults} onChange={(v) => editCase(c.id, { expectedResults: v })} /></td>
                        <td className="border-l"><IN value={c.runBy} onChange={(v) => editCase(c.id, { runBy: v })} list="uat-users" /></td>
                        <td className="border-l"><input type="date" value={c.dateRun} onChange={(e) => editCase(c.id, { dateRun: e.target.value })} className="w-full bg-transparent px-2 py-1.5 text-sm tabular-nums outline-none focus:bg-muted/50" /></td>
                        <td className="border-l px-2 py-1.5">
                          <select value={c.result} onChange={(e) => editCase(c.id, { result: e.target.value as UatResult })} className={cn("w-full cursor-pointer rounded-full border-0 px-2 py-1 text-xs font-medium outline-none focus:ring-2 focus:ring-ring", UAT_RESULT_TONE[c.result])}>
                            {UAT_RESULTS.map((s) => <option key={s} value={s} className="bg-background text-foreground">{UAT_RESULT_LABEL[s]}</option>)}
                          </select>
                        </td>
                        <td className="border-l"><TA value={c.reasonForFailure} onChange={(v) => editCase(c.id, { reasonForFailure: v })} /></td>
                        <td className="border-l"><IN value={c.docNo} onChange={(v) => editCase(c.id, { docNo: v })} /></td>
                        <td className="border-l"><TA value={c.comments} onChange={(v) => editCase(c.id, { comments: v })} /></td>
                        <td className="border-l pt-2 text-center"><button type="button" onClick={() => delCase(c.id)} title="Delete test case" className="text-muted-foreground/30 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"><Trash2Icon className="size-3.5" /></button></td>
                      </tr>
                    ))}
                    {cs.length === 0 && <tr><td colSpan={11} className="px-3 py-3 text-center text-xs text-muted-foreground">No test cases yet.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="border-t px-3 py-1.5">
                <button type="button" onClick={() => addCase(a.id)} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary"><PlusIcon className="size-3.5" /> Add test case</button>
              </div>
            </div>
          );
        })
      )}

      {/* Issue log */}
      <div className="flex items-center gap-3">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"><BugIcon className="size-3.5" /> Test issue summary</h2>
        <span className="h-px flex-1 bg-border" />
        <Button variant="outline" size="sm" onClick={addIssue} className="gap-1.5"><PlusIcon className="size-4" /> Add issue</Button>
      </div>
      {d.issues.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No issues logged.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                <th className="w-10 px-2 py-2 font-medium">#</th>
                <th className="w-32 px-2 py-2 font-medium">Area / tab</th>
                <th className="w-16 px-2 py-2 font-medium">Test #</th>
                <th className="w-20 px-2 py-2 font-medium">Type</th>
                <th className="min-w-56 px-2 py-2 font-medium">Description</th>
                <th className="min-w-56 px-2 py-2 font-medium">Corrective action</th>
                <th className="w-28 px-2 py-2 font-medium">Assigned</th>
                <th className="w-24 px-2 py-2 font-medium">Status</th>
                <th className="w-32 px-2 py-2 font-medium">Raised</th>
                <th className="w-32 px-2 py-2 font-medium">Closed</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {d.issues.map((i, ii) => (
                <tr key={i.id} className="group border-b align-top last:border-none hover:bg-muted/20">
                  <td className="px-2 py-2 text-center font-mono text-xs text-muted-foreground tabular-nums">{ii + 1}</td>
                  <td className="border-l"><IN value={i.areaRef} onChange={(v) => editIssue(i.id, { areaRef: v })} list="uat-areas" /></td>
                  <td className="border-l"><IN value={i.testRef} onChange={(v) => editIssue(i.id, { testRef: v })} className="tabular-nums" /></td>
                  <td className="border-l"><IN value={i.type} onChange={(v) => editIssue(i.id, { type: v })} placeholder="KO/Redo" /></td>
                  <td className="border-l"><TA value={i.description} onChange={(v) => editIssue(i.id, { description: v })} /></td>
                  <td className="border-l"><TA value={i.correctiveAction} onChange={(v) => editIssue(i.id, { correctiveAction: v })} /></td>
                  <td className="border-l"><IN value={i.assigned} onChange={(v) => editIssue(i.id, { assigned: v })} list="uat-users" /></td>
                  <td className="border-l px-2 py-1.5">
                    <select value={i.status} onChange={(e) => editIssue(i.id, { status: e.target.value as UatIssueStatus })} className={cn("w-full cursor-pointer rounded-full border-0 px-2 py-1 text-xs font-medium outline-none focus:ring-2 focus:ring-ring", i.status === "OPEN" ? "bg-rose-500/15 text-rose-700 dark:text-rose-400" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400")}>
                      <option value="OPEN" className="bg-background text-foreground">Open</option>
                      <option value="CLOSED" className="bg-background text-foreground">Closed</option>
                    </select>
                  </td>
                  <td className="border-l"><input type="date" value={i.dateRaised} onChange={(e) => editIssue(i.id, { dateRaised: e.target.value })} className="w-full bg-transparent px-2 py-1.5 text-sm tabular-nums outline-none focus:bg-muted/50" /></td>
                  <td className="border-l"><input type="date" value={i.dateClosed} onChange={(e) => editIssue(i.id, { dateClosed: e.target.value })} className="w-full bg-transparent px-2 py-1.5 text-sm tabular-nums outline-none focus:bg-muted/50" /></td>
                  <td className="border-l pt-2 text-center"><button type="button" onClick={() => delIssue(i.id)} title="Delete issue" className="text-muted-foreground/30 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"><Trash2Icon className="size-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <datalist id="uat-users">{userNames.map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="uat-areas">{d.areas.map((a) => a.name && <option key={a.id} value={a.name} />)}</datalist>

      <p className="text-xs text-muted-foreground">Result <strong>OK / KO / Redo</strong> per test case rolls up into each area&apos;s totals. Changes are stored only when you press <strong>Save</strong>; export to Excel to share with the customer (summary + a tab per area + issue log).</p>
    </div>
  );
}

function TA({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <textarea rows={1} ref={(el) => autoGrow(el)} onInput={(e) => autoGrow(e.currentTarget)} value={value} onChange={(e) => onChange(e.target.value)} className="w-full resize-none overflow-hidden bg-transparent px-2 py-1.5 text-sm leading-snug outline-none focus:bg-muted/50" />;
}
function IN({ value, onChange, list, placeholder, className }: { value: string; onChange: (v: string) => void; list?: string; placeholder?: string; className?: string }) {
  return <input value={value} list={list} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cn("w-full bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-muted/50", className)} />;
}
function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", tone)}>{children}</span>;
}
function Tally({ label, n, tone }: { label: string; n: number; tone: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm", tone)}>
      <span className="font-semibold tabular-nums">{n}</span>
      <span className="text-xs opacity-80">{label}</span>
    </span>
  );
}
