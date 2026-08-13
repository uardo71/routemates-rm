import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { detectMissingTimecards, type NudgeMode } from "@/lib/timesheet-nudge";
import { graphMailConfigured, sendGraphMail } from "@/lib/graph-mail";
import { teamsWebhookConfigured, postTeamsMessage } from "@/lib/teams-webhook";
import { getTimesheetNudgeConfig, getNudgeLastRun, setNudgeLastRun } from "@/lib/settings";
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

function authorized(req: NextRequest): boolean {
  const secret = process.env.TIMESHEET_NUDGE_SECRET;
  if (!secret) return false; // not configured → route is closed
  const provided = req.headers.get("x-nudge-secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false; // timingSafeEqual requires equal lengths
  return timingSafeEqual(a, b);
}

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
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const mode: NudgeMode = searchParams.get("mode") === "weekly" ? "weekly" : "daily";
  const dryRun = ["1", "true"].includes(searchParams.get("dryRun") ?? "");
  const force = ["1", "true"].includes(searchParams.get("force") ?? "");

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

  const notifications = {
    email: { configured: graphMailConfigured() && cfg.emailEnabled, sent: [] as string[], errors: [] as string[] },
    teams: { configured: teamsWebhookConfigured() && cfg.teamsEnabled, status: "skipped" as string },
  };

  if (result.missing.length > 0) {
    if (notifications.email.configured) {
      for (const p of result.missing) {
        try {
          const vars = {
            firstName: firstName(p.name),
            name: p.name,
            dates: p.missingDates.join(", "),
            count: String(p.missingDates.length),
            mode,
          };
          const subject = renderTemplate(cfg.emailSubject, vars);
          const html = escapeHtml(renderTemplate(cfg.emailBody, vars)).replace(/\n/g, "<br>");
          await sendGraphMail({ to: p.email, subject, html });
          notifications.email.sent.push(p.email);
        } catch (e) {
          notifications.email.errors.push(`${p.email}: ${(e as Error).message}`);
        }
      }
    }

    if (notifications.teams.configured) {
      const range =
        result.checkedDates.length === 1
          ? result.checkedDates[0]
          : `${result.checkedDates[0]} … ${result.checkedDates[result.checkedDates.length - 1]}`;
      const list = result.missing.map((p) => `- **${p.name}** — ${p.missingDates.join(", ")}`).join("\n");
      const markdown = renderTemplate(cfg.teamsMessage, {
        count: String(result.missing.length),
        list,
        mode,
        range,
      });
      try {
        await postTeamsMessage({ title: `⏰ Timesheet nudge — ${mode} (${range})`, markdown });
        notifications.teams.status = "sent";
      } catch (e) {
        notifications.teams.status = `error: ${(e as Error).message}`;
      }
    }
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
