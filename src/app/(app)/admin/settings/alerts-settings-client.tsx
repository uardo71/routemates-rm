"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BellRingIcon, PlayIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ALERT_RULE_META, type AlertsConfig, type AlertKind } from "@/lib/alerts/config";
import { saveAlertsConfigAction, previewAlertsAction } from "./actions";

type Preview = Awaited<ReturnType<typeof previewAlertsAction>>;

function Toggle({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label htmlFor={id} className={cn("flex items-start gap-2.5 rounded-lg border p-3 transition-colors", checked ? "border-primary/40 bg-primary/[0.03]" : "bg-card", disabled && "opacity-60")}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/** "80, 100" ⇄ [80, 100] — a comma list is the least surprising way to edit a small set of numbers. */
function parseList(s: string): number[] {
  return s.split(/[,\s]+/).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n >= 0);
}

export function AlertsSettingsClient({ config, emailConfigured, teamsConfigured, secretConfigured }: {
  config: AlertsConfig; emailConfigured: boolean; teamsConfigured: boolean; secretConfigured: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [c, setC] = useState<AlertsConfig>(config);
  const [budgetText, setBudgetText] = useState(config.rules.project_budget.thresholds.join(", "));
  const [overdueText, setOverdueText] = useState(config.rules.invoice_overdue.days.join(", "));
  const [certText, setCertText] = useState(config.rules.certification_expiry.days.join(", "));
  const [preview, setPreview] = useState<Preview | null>(null);
  const rule = <K extends AlertKind>(k: K, patch: Partial<AlertsConfig["rules"][K]>) =>
    setC((x) => ({ ...x, rules: { ...x.rules, [k]: { ...x.rules[k], ...patch } } }));

  function save() {
    const thresholds = parseList(budgetText);
    const days = parseList(overdueText);
    if (thresholds.length === 0) return toast.error("Budget thresholds need at least one percentage.");
    if (days.length === 0) return toast.error("Overdue tiers need at least one day count.");
    const certDays = parseList(certText);
    if (certDays.length === 0) return toast.error("Certification tiers need at least one day count.");
    const payload: AlertsConfig = { ...c, rules: { ...c.rules, project_budget: { ...c.rules.project_budget, thresholds }, invoice_overdue: { ...c.rules.invoice_overdue, days }, certification_expiry: { ...c.rules.certification_expiry, days: certDays } } };
    start(async () => {
      const r = await saveAlertsConfigAction(payload);
      if (r.error) toast.error(r.error); else { toast.success("Alert settings saved."); router.refresh(); }
    });
  }
  function runPreview() {
    start(async () => {
      const r = await previewAlertsAction();
      setPreview(r);
      if ("error" in r && r.error) toast.error(r.error);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><BellRingIcon className="size-4 text-muted-foreground" /> Operational alerts</CardTitle>
          <p className="text-xs text-muted-foreground">
            One scheduled call a day to <code className="rounded bg-muted px-1">POST /api/internal/alerts</code> (same secret header as the timesheet nudge) sends every alert below.
            Each alert goes out <strong>once</strong> — the sent-ledger stops repeats, so re-running is always safe.
            {!secretConfigured && <span className="ml-1 text-amber-600">TIMESHEET_NUDGE_SECRET is not set, so the endpoint is closed.</span>}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Toggle id="al-enabled" label="Alerts enabled" hint="Master switch — off evaluates nothing." checked={c.enabled} onChange={(v) => setC({ ...c, enabled: v })} />
            <Toggle id="al-email" label="Email" hint={emailConfigured ? "Microsoft Graph mail is configured." : "Not configured (Mail.Send + GRAPH_MAIL_SENDER)."} checked={c.emailEnabled} onChange={(v) => setC({ ...c, emailEnabled: v })} />
            <Toggle id="al-teams" label="Teams channel" hint={teamsConfigured ? "Incoming webhook is configured." : "Not configured (TEAMS_WEBHOOK_URL)."} checked={c.teamsEnabled} onChange={(v) => setC({ ...c, teamsEnabled: v })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Rules</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <RuleRow kind="project_budget" enabled={c.rules.project_budget.enabled} onEnabled={(v) => rule("project_budget", { enabled: v })}>
            <Label htmlFor="al-bt" className="text-xs">Thresholds (% used)</Label>
            <Input id="al-bt" value={budgetText} onChange={(e) => setBudgetText(e.target.value)} className="h-8 w-40" placeholder="80, 100" />
          </RuleRow>
          <RuleRow kind="invoice_overdue" enabled={c.rules.invoice_overdue.enabled} onEnabled={(v) => rule("invoice_overdue", { enabled: v })}>
            <Label htmlFor="al-od" className="text-xs">Days past due</Label>
            <Input id="al-od" value={overdueText} onChange={(e) => setOverdueText(e.target.value)} className="h-8 w-40" placeholder="1, 14, 30" />
          </RuleRow>
          <RuleRow kind="approval_stale" enabled={c.rules.approval_stale.enabled} onEnabled={(v) => rule("approval_stale", { enabled: v })}>
            <Label htmlFor="al-st" className="text-xs">Waiting more than (days)</Label>
            <Input id="al-st" type="number" min={0} value={c.rules.approval_stale.staleDays} onChange={(e) => rule("approval_stale", { staleDays: Math.max(0, Number(e.target.value) || 0) })} className="h-8 w-24" />
          </RuleRow>
          <RuleRow kind="expiry" enabled={c.rules.expiry.enabled} onEnabled={(v) => rule("expiry", { enabled: v })}>
            <Label htmlFor="al-ex" className="text-xs">Within (days)</Label>
            <Input id="al-ex" type="number" min={0} value={c.rules.expiry.days} onChange={(e) => rule("expiry", { days: Math.max(0, Number(e.target.value) || 0) })} className="h-8 w-24" />
          </RuleRow>
          <RuleRow kind="milestone_overdue" enabled={c.rules.milestone_overdue.enabled} onEnabled={(v) => rule("milestone_overdue", { enabled: v })} />
          <RuleRow kind="certification_expiry" enabled={c.rules.certification_expiry.enabled} onEnabled={(v) => rule("certification_expiry", { enabled: v })}>
            <Label htmlFor="al-ce" className="text-xs">Days before expiry</Label>
            <Input id="al-ce" value={certText} onChange={(e) => setCertText(e.target.value)} className="h-8 w-40" placeholder="90, 30" />
          </RuleRow>
          <RuleRow kind="status_overdue" enabled={c.rules.status_overdue.enabled} onEnabled={(v) => rule("status_overdue", { enabled: v })} />
          <RuleRow kind="plan_slipping" enabled={c.rules.plan_slipping.enabled} onEnabled={(v) => rule("plan_slipping", { enabled: v })} />
          <RuleRow kind="issue_overdue" enabled={c.rules.issue_overdue.enabled} onEnabled={(v) => rule("issue_overdue", { enabled: v })} />
          <RuleRow kind="golive_readiness" enabled={c.rules.golive_readiness.enabled} onEnabled={(v) => rule("golive_readiness", { enabled: v })} />
          <RuleRow kind="delivery_digest" enabled={c.rules.delivery_digest.enabled} onEnabled={(v) => rule("delivery_digest", { enabled: v })}>
            <Label htmlFor="al-dg" className="text-xs">Send on</Label>
            <select id="al-dg" value={c.rules.delivery_digest.weekday} onChange={(e) => rule("delivery_digest", { weekday: Number(e.target.value) })} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
              {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
            </select>
          </RuleRow>
          <RuleRow kind="hygiene_weekly" enabled={c.rules.hygiene_weekly.enabled} onEnabled={(v) => rule("hygiene_weekly", { enabled: v })}>
            <Label htmlFor="al-hy" className="text-xs">Send on</Label>
            <select id="al-hy" value={c.rules.hygiene_weekly.weekday} onChange={(e) => rule("hygiene_weekly", { weekday: Number(e.target.value) })} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
              {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
            </select>
          </RuleRow>

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save alert settings"}</Button>
            <Button size="sm" variant="outline" onClick={runPreview} disabled={pending} className="gap-1.5"><PlayIcon className="size-3.5" /> Preview today&apos;s alerts</Button>
            <span className="text-xs text-muted-foreground">Preview evaluates the rules with the <em>saved</em> settings and sends nothing.</span>
          </div>
        </CardContent>
      </Card>

      {preview && !("error" in preview && preview.error) && "candidates" in preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Preview — {preview.candidates.length} alert{preview.candidates.length === 1 ? "" : "s"} today
              {preview.suppressed > 0 && <span className="ml-2 font-normal text-muted-foreground">({preview.suppressed} already sent, would be skipped)</span>}
              {preview.skipped && <span className="ml-2 font-normal text-amber-600">— {preview.skipped}</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {preview.candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing would be sent right now.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 pr-3">Rule</th><th className="py-1.5 pr-3">Alert</th><th className="py-1.5 pr-3">To</th><th className="py-1.5">Status</th></tr></thead>
                <tbody>
                  {preview.candidates.map((a, i) => (
                    <tr key={i} className={cn("border-b last:border-none", a.alreadySent && "text-muted-foreground")}>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{ALERT_RULE_META[a.kind as AlertKind]?.label ?? a.kind}</td>
                      <td className="py-1.5 pr-3">{a.subject}</td>
                      <td className="py-1.5 pr-3 text-xs">{a.recipients.length ? a.recipients.join(", ") : <span className="text-amber-600">no recipient</span>}</td>
                      <td className="py-1.5">{a.alreadySent ? <Badge variant="secondary">already sent</Badge> : <Badge>would send</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RuleRow({ kind, enabled, onEnabled, children }: { kind: AlertKind; enabled: boolean; onEnabled: (v: boolean) => void; children?: React.ReactNode }) {
  const meta = ALERT_RULE_META[kind];
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3", enabled ? "bg-card" : "bg-muted/30 opacity-70")}>
      <label className="flex min-w-0 flex-1 items-start gap-2.5">
        <input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} className="mt-0.5 size-4" />
        <span className="min-w-0">
          <span className="block text-sm font-medium">{meta.label}</span>
          <span className="block text-xs text-muted-foreground">{meta.description}</span>
          <span className="block text-[11px] text-muted-foreground/80">→ {meta.recipients}</span>
        </span>
      </label>
      {children && <div className="flex flex-col gap-1">{children}</div>}
    </div>
  );
}
