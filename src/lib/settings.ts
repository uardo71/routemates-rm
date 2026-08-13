import { prisma } from "@/lib/prisma";

// Global app settings (see model AppSetting). Kept tiny and dependency-light so it can be read from
// the login page and the Credentials authorize() — i.e. BEFORE there is a session.

const PASSWORD_LOGIN_KEY = "passwordLoginEnabled";

/** Whether Microsoft Entra ID SSO is configured (env vars present). */
export function microsoftConfigured(): boolean {
  return !!(process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET);
}

/** The raw admin toggle value (defaults to enabled when never set). This is what the admin panel
 *  shows and flips — independent of the break-glass overrides below. */
export async function getPasswordLoginSetting(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: PASSWORD_LOGIN_KEY } });
  return row ? row.value === "true" : true;
}

export async function setPasswordLoginSetting(enabled: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: PASSWORD_LOGIN_KEY },
    create: { key: PASSWORD_LOGIN_KEY, value: enabled ? "true" : "false" },
    update: { value: enabled ? "true" : "false" },
  });
}

/** Whether email+password login is ACTUALLY allowed right now — the value both the login UI and the
 *  server-side authorize() must honour. Break-glass guarantees you can never lock everyone out:
 *   • if SSO isn't configured, password login is always available (there'd be no other way in);
 *   • if AUTH_ALLOW_PASSWORD_LOGIN=true (an env override you set on the server in an emergency),
 *     password login is forced on regardless of the DB toggle;
 *   • otherwise the admin toggle decides (default enabled). */
export async function isPasswordLoginAllowed(): Promise<boolean> {
  if (!microsoftConfigured()) return true;
  if (process.env.AUTH_ALLOW_PASSWORD_LOGIN === "true") return true;
  return getPasswordLoginSetting();
}

// ---------- Timesheet nudge ----------

const TIMESHEET_NUDGE_KEY = "timesheetNudge";

// Admin-editable behaviour for the timesheet nudge (the actual detect/notify runs in
// src/lib/timesheet-nudge.ts + /api/internal/timesheet-nudge). Stored as one JSON blob in AppSetting.
export type TimesheetNudgeConfig = {
  enabled: boolean; // master switch
  includeContractors: boolean;
  dailyEnabled: boolean;
  weeklyEnabled: boolean;
  weeklyWeekday: number; // ISO 1=Mon … 7=Sun — the day a weekly run actually sends
  emailEnabled: boolean;
  teamsEnabled: boolean;
  excludedUserIds: string[]; // never nudged
  emailSubject: string;
  emailBody: string; // placeholders: {firstName} {name} {dates} {count} {mode}
  teamsMessage: string; // placeholders: {count} {list} {mode} {range}
};

export const DEFAULT_TIMESHEET_NUDGE_CONFIG: TimesheetNudgeConfig = {
  enabled: true,
  includeContractors: true,
  dailyEnabled: true,
  weeklyEnabled: true,
  weeklyWeekday: 5, // Friday
  emailEnabled: true,
  teamsEnabled: true,
  excludedUserIds: [],
  emailSubject: "Reminder: log your timesheet",
  emailBody:
    "Hi {firstName},\n\nWe don't have time logged from you for {dates}. When you get a moment, please log your hours in RM Ops.\n\nThanks!",
  teamsMessage: "{count} missing a timecard ({range}):\n\n{list}",
};

/** Reads the config, merged onto defaults so new fields always have a value even for an old row. */
export async function getTimesheetNudgeConfig(): Promise<TimesheetNudgeConfig> {
  const row = await prisma.appSetting.findUnique({ where: { key: TIMESHEET_NUDGE_KEY } });
  if (!row) return { ...DEFAULT_TIMESHEET_NUDGE_CONFIG };
  try {
    const parsed = JSON.parse(row.value) as Partial<TimesheetNudgeConfig>;
    return {
      ...DEFAULT_TIMESHEET_NUDGE_CONFIG,
      ...parsed,
      excludedUserIds: Array.isArray(parsed.excludedUserIds) ? parsed.excludedUserIds : [],
    };
  } catch {
    return { ...DEFAULT_TIMESHEET_NUDGE_CONFIG };
  }
}

export async function setTimesheetNudgeConfig(config: TimesheetNudgeConfig): Promise<void> {
  const value = JSON.stringify(config);
  await prisma.appSetting.upsert({
    where: { key: TIMESHEET_NUDGE_KEY },
    create: { key: TIMESHEET_NUDGE_KEY, value },
    update: { value },
  });
}

// Per-mode "last actually sent on" marker (yyyy-MM-dd), so a frequent external trigger produces at
// most one real send per mode per day. Kept separate from the admin config so saving settings never
// clobbers it.
function lastRunKey(mode: "daily" | "weekly"): string {
  return `timesheetNudgeLastRun:${mode}`;
}
export async function getNudgeLastRun(mode: "daily" | "weekly"): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: lastRunKey(mode) } });
  return row?.value ?? null;
}
export async function setNudgeLastRun(mode: "daily" | "weekly", dateStr: string): Promise<void> {
  const key = lastRunKey(mode);
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: dateStr },
    update: { value: dateStr },
  });
}
