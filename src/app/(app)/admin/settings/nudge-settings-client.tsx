"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDownIcon, UsersIcon, MessageSquareTextIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RoleBadge } from "@/components/role-badge";
import { cn } from "@/lib/utils";
import type { TimesheetNudgeConfig } from "@/lib/settings";
import { saveTimesheetNudgeConfigAction } from "./actions";

const WEEKDAYS = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "7", label: "Sunday" },
];

function ToggleTile({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-lg border p-3 transition-colors", checked ? "border-primary/40 bg-primary/[0.03]" : "bg-card")}>
      <label htmlFor={id} className="flex items-start gap-2.5">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 size-4"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium">{label}</span>
          {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
        </span>
      </label>
      {children}
    </div>
  );
}

function Collapsible({
  open,
  onToggle,
  icon: Icon,
  title,
  summary,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  icon: typeof UsersIcon;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{summary}</span>
        </span>
        <ChevronDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="border-t px-3 py-3">{children}</div>}
    </div>
  );
}

export function NudgeSettingsClient({
  config,
  users,
  emailConfigured,
  teamsConfigured,
  secretConfigured,
}: {
  config: TimesheetNudgeConfig;
  users: { id: string; name: string; role: string }[];
  emailConfigured: boolean;
  teamsConfigured: boolean;
  secretConfigured: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [cfg, setCfg] = useState<TimesheetNudgeConfig>(config);
  const [showExclusions, setShowExclusions] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  function set<K extends keyof TimesheetNudgeConfig>(key: K, value: TimesheetNudgeConfig[K]) {
    setCfg((c) => ({ ...c, [key]: value }));
  }

  function toggleExcluded(userId: string, excluded: boolean) {
    setCfg((c) => ({
      ...c,
      excludedUserIds: excluded
        ? [...new Set([...c.excludedUserIds, userId])]
        : c.excludedUserIds.filter((id) => id !== userId),
    }));
  }

  function save() {
    start(async () => {
      const r = await saveTimesheetNudgeConfigAction(cfg);
      if (r.error) toast.error(r.error);
      else {
        toast.success("Timesheet nudge settings saved.");
        router.refresh();
      }
    });
  }

  const excludedCount = cfg.excludedUserIds.length;
  const weekdayLabel = WEEKDAYS.find((w) => w.value === String(cfg.weeklyWeekday))?.label ?? "—";

  return (
    <Card className="max-w-3xl">
      <CardHeader className="border-b">
        <CardTitle className="text-base">Timesheet nudge</CardTitle>
        <CardAction className="flex flex-wrap gap-1.5">
          <Badge variant={secretConfigured ? "secondary" : "destructive"}>
            {secretConfigured ? "Endpoint set" : "No endpoint secret"}
          </Badge>
          <Badge variant={emailConfigured ? "secondary" : "outline"}>
            {emailConfigured ? "Email ready" : "Email off"}
          </Badge>
          <Badge variant={teamsConfigured ? "secondary" : "outline"}>
            {teamsConfigured ? "Teams ready" : "Teams off"}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {/* Master */}
        <ToggleTile
          id="nudge-enabled"
          label="Enable timesheet nudge"
          hint="Master switch — when off, nothing is ever sent."
          checked={cfg.enabled}
          onChange={(v) => set("enabled", v)}
        />

        {/* Toggles grid */}
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <ToggleTile
              id="daily-enabled"
              label="Daily reminder"
              hint="Missed yesterday → nudge."
              checked={cfg.dailyEnabled}
              onChange={(v) => set("dailyEnabled", v)}
            >
              {null}
            </ToggleTile>

            <ToggleTile
              id="weekly-enabled"
              label="Weekly summary"
              hint="Behind this week → nudge."
              checked={cfg.weeklyEnabled}
              onChange={(v) => set("weeklyEnabled", v)}
            >
              {cfg.weeklyEnabled && (
                <div className="mt-2.5 flex items-center gap-2 pl-[1.625rem]">
                  <span className="text-xs text-muted-foreground">Sends on</span>
                  <Select
                    value={String(cfg.weeklyWeekday)}
                    onValueChange={(v) => set("weeklyWeekday", Number(v))}
                    items={WEEKDAYS}
                  >
                    <SelectTrigger size="sm" className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map((w) => (
                        <SelectItem key={w.value} value={w.value}>
                          {w.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </ToggleTile>

            <ToggleTile
              id="email-enabled"
              label="Email each person"
              hint={emailConfigured ? "Individual reminder emails." : "Needs GRAPH_MAIL_SENDER + Entra vars."}
              checked={cfg.emailEnabled}
              onChange={(v) => set("emailEnabled", v)}
            />

            <ToggleTile
              id="teams-enabled"
              label="Teams summary"
              hint={teamsConfigured ? "One channel message." : "Needs TEAMS_WEBHOOK_URL."}
              checked={cfg.teamsEnabled}
              onChange={(v) => set("teamsEnabled", v)}
            />

            <ToggleTile
              id="include-contractors"
              label="Include contractors"
              hint="Off = employees only."
              checked={cfg.includeContractors}
              onChange={(v) => set("includeContractors", v)}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Each run sends at most once per day, so a frequent scheduler is safe. Weekly only fires on {weekdayLabel}.
          </p>

          {/* Exclusions */}
          <Collapsible
            open={showExclusions}
            onToggle={() => setShowExclusions((s) => !s)}
            icon={UsersIcon}
            title="Never nudge"
            summary={excludedCount > 0 ? `${excludedCount} excluded` : "Everyone is nudged"}
          >
            <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
              {users.map((u) => (
                <label
                  key={u.id}
                  htmlFor={`excl-${u.id}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
                >
                  <input
                    id={`excl-${u.id}`}
                    type="checkbox"
                    checked={cfg.excludedUserIds.includes(u.id)}
                    onChange={(e) => toggleExcluded(u.id, e.target.checked)}
                    className="size-4"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{u.name}</span>
                  <RoleBadge role={u.role} />
                </label>
              ))}
              {users.length === 0 && <p className="p-2 text-sm text-muted-foreground">No active users.</p>}
            </div>
          </Collapsible>

          {/* Templates */}
          <Collapsible
            open={showTemplates}
            onToggle={() => setShowTemplates((s) => !s)}
            icon={MessageSquareTextIcon}
            title="Message templates"
            summary="Email subject, email body, and Teams message"
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email-subject">Email subject</Label>
                <Input
                  id="email-subject"
                  value={cfg.emailSubject}
                  onChange={(e) => set("emailSubject", e.target.value)}
                  maxLength={200}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email-body">Email body</Label>
                <Textarea
                  id="email-body"
                  value={cfg.emailBody}
                  onChange={(e) => set("emailBody", e.target.value)}
                  rows={5}
                  maxLength={4000}
                />
                <p className="text-xs text-muted-foreground">
                  <code className="rounded bg-muted px-1">{"{firstName}"}</code>{" "}
                  <code className="rounded bg-muted px-1">{"{name}"}</code>{" "}
                  <code className="rounded bg-muted px-1">{"{dates}"}</code>{" "}
                  <code className="rounded bg-muted px-1">{"{count}"}</code>{" "}
                  <code className="rounded bg-muted px-1">{"{mode}"}</code> · line breaks kept
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="teams-message">Teams message</Label>
                <Textarea
                  id="teams-message"
                  value={cfg.teamsMessage}
                  onChange={(e) => set("teamsMessage", e.target.value)}
                  rows={4}
                  maxLength={4000}
                />
                <p className="text-xs text-muted-foreground">
                  <code className="rounded bg-muted px-1">{"{count}"}</code>{" "}
                  <code className="rounded bg-muted px-1">{"{list}"}</code>{" "}
                  <code className="rounded bg-muted px-1">{"{range}"}</code>{" "}
                  <code className="rounded bg-muted px-1">{"{mode}"}</code> · markdown
                </p>
              </div>
            </div>
          </Collapsible>
        </div>

        <div className="flex items-center gap-3 border-t pt-4">
          <Button onClick={save} disabled={pending} className="w-fit">
            {pending ? "Saving…" : "Save nudge settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
