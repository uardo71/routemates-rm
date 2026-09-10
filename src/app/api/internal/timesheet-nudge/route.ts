import { NextRequest, NextResponse } from "next/server";
import { detectMissingTimecards, type NudgeMode } from "@/lib/timesheet-nudge";
import { notify, type EmailRecipient } from "@/lib/notify";
import { getTimesheetNudgeConfig, getNudgeLastRun, setNudgeLastRun } from "@/lib/settings";
import { authorizedInternal, flag } from "@/lib/internal-auth";
import { toDateParam } from "@/lib/week";

// Deployment-agnostic entry point: whatever scheduler you wire up later just POSTs this URL with the
// shared secret header. Behaviour (enable, cadence, channels, exclusions, templates) is admin-editable
// at /admin/settings. It is intentionally NOT behind app RBAC/session — the header is the only gate.
//
//   POST /api/internal/timesheet-nudge?mode=daily|weekly&dryRun=0|1&force=0|1
//   header: x-nudge-secret: <TIMESHEET_NUDGE_SECRET>
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEEKDAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// Replaces {placeholder} tokens; unknown tokens are left as-is so a typo is visible rather than silent.
function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export async function POST(req: NextRequest) {
  if (!authorizedInternal(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const mode: NudgeMode = searchParams.get("mode") === "weekly" ? "weekly" : "daily";
  const dryRun = flag(searchParams.get("dryRun"));
  const force = flag(searchParams.get("force"));

  const cfg = await getTimesheetNudgeConfig();
  const now = new Date();
  const isoWeekday = ((now.getDay() + 6) % 7) + 1; // Mon=1 … Sun=7
  const todayStr = toDateParam(now);

  // Decide whether this run should actually send. `force` bypasses the weekday gate + once-a-day dedup
  // (for manual testing); it never bypasses the enable toggles.
  let skip: string | null = null;
  if (!cfg.enabled) skip = "nudge disabled in settings";
  else if (mode === "daily" && !cfg.dailyEnabled) skip = "daily run disabled in settings";
  else if (mode === "weekly" && !cfg.weeklyEnabled) skip = "weekly run disabled in settings";
  else if (mode === "weekly" && !force && isoWeekday !== cfg.weeklyWeekday)
    skip = `not the weekly send day (configured: ${WEEKDAY_NAMES[cfg.weeklyWeekday] ?? cfg.weeklyWeekday})`;
  else if (!force && !dryRun && (await getNudgeLastRun(mode)) === todayStr) skip = "already ran today";

  const result = await detectMissingTimecards(mode, {
    includeContractors: cfg.includeContractors,
    excludedUserIds: cfg.excludedUserIds,
  });

  // Dry run: report the computed list and whether a real run would send, but never send or dedup.
  if (dryRun) {
    return NextResponse.json({
      ok: true,
      mode,
      dryRun: true,
      wouldSend: skip === null,
      skipReason: skip,
      checkedDates: result.checkedDates,
      consideredCount: result.totalConsidered,
      missingCount: result.missing.length,
      missing: result.missing,
    });
  }

  if (skip) {
    return NextResponse.json({ ok: true, mode, skipped: skip, missingCount: result.missing.length });
  }

  // Same response shape as before the shared notify() existed: per-channel configured/sent/errors.
  let notifications = {
    email: { configured: false, sent: [] as string[], errors: [] as string[] },
    teams: { configured: false, status: "skipped" as string },
  };

  if (result.missing.length > 0) {
    // One personalised email per missing person; one Teams post listing everyone.
    const recipients: EmailRecipient[] = result.missing.map((p) => {
      const vars = {
        firstName: firstName(p.name),
        name: p.name,
        dates: p.missingDates.join(", "),
        count: String(p.missingDates.length),
        mode,
      };
      return {
        to: p.email,
        subject: renderTemplate(cfg.emailSubject, vars),
        html: escapeHtml(renderTemplate(cfg.emailBody, vars)).replace(/\n/g, "<br>"),
      };
    });
    const range =
      result.checkedDates.length === 1
        ? result.checkedDates[0]
        : `${result.checkedDates[0]} … ${result.checkedDates[result.checkedDates.length - 1]}`;
    const list = result.missing.map((p) => `- **${p.name}** — ${p.missingDates.join(", ")}`).join("\n");
    const teamsText = renderTemplate(cfg.teamsMessage, { count: String(result.missing.length), list, mode, range });

    notifications = await notify({
      subject: cfg.emailSubject,
      html: "",
      recipients,
      teamsTitle: `⏰ Timesheet nudge — ${mode} (${range})`,
      teamsText,
      channels: { email: cfg.emailEnabled, teams: cfg.teamsEnabled },
    });
  }

  // Mark this mode as run today so a frequent trigger doesn't re-send (skipped when nobody's missing —
  // there was nothing to send, so a later run today can still catch someone who since fell behind).
  if (result.missing.length > 0) {
    await setNudgeLastRun(mode, todayStr);
  }

  return NextResponse.json({
    ok: true,
    mode,
    dryRun: false,
    checkedDates: result.checkedDates,
    consideredCount: result.totalConsidered,
    missingCount: result.missing.length,
    missing: result.missing,
    notifications,
  });
}
