"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/session";
import { setPasswordLoginSetting, setTimesheetNudgeConfig, setAlertsConfig } from "@/lib/settings";
import { mergeAlertsConfig } from "@/lib/alerts/config";
import { runAlerts, type AlertsRunReport } from "@/lib/alerts/run";

export async function setPasswordLoginAction(enabled: boolean): Promise<{ error?: string }> {
  await requirePermission("users:manage");
  await setPasswordLoginSetting(enabled);
  revalidatePath("/admin/settings");
  revalidatePath("/login");
  return {};
}

const NudgeConfigSchema = z.object({
  enabled: z.boolean(),
  includeContractors: z.boolean(),
  dailyEnabled: z.boolean(),
  weeklyEnabled: z.boolean(),
  weeklyWeekday: z.number().int().min(1).max(7),
  emailEnabled: z.boolean(),
  teamsEnabled: z.boolean(),
  excludedUserIds: z.array(z.string()),
  emailSubject: z.string().trim().min(1, "Email subject can't be empty").max(200),
  emailBody: z.string().trim().min(1, "Email body can't be empty").max(4000),
  teamsMessage: z.string().trim().min(1, "Teams message can't be empty").max(4000),
});

export async function saveTimesheetNudgeConfigAction(input: unknown): Promise<{ error?: string }> {
  await requirePermission("users:manage");
  const parsed = NudgeConfigSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid settings" };
  await setTimesheetNudgeConfig(parsed.data);
  revalidatePath("/admin/settings");
  return {};
}

const AlertsConfigSchema = z.object({
  enabled: z.boolean(),
  emailEnabled: z.boolean(),
  teamsEnabled: z.boolean(),
  rules: z.object({
    project_budget: z.object({ enabled: z.boolean(), thresholds: z.array(z.number().min(0).max(1000)).min(1) }),
    invoice_overdue: z.object({ enabled: z.boolean(), days: z.array(z.number().int().min(0).max(3650)).min(1) }),
    approval_stale: z.object({ enabled: z.boolean(), staleDays: z.number().int().min(0).max(365) }),
    expiry: z.object({ enabled: z.boolean(), days: z.number().int().min(0).max(3650) }),
    milestone_overdue: z.object({ enabled: z.boolean() }),
    certification_expiry: z.object({ enabled: z.boolean(), days: z.array(z.number().int().min(0).max(3650)).min(1) }),
  }),
});

export async function saveAlertsConfigAction(input: unknown): Promise<{ error?: string }> {
  await requirePermission("users:manage");
  const parsed = AlertsConfigSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid settings" };
  await setAlertsConfig(mergeAlertsConfig(parsed.data));
  revalidatePath("/admin/settings");
  return {};
}

/** Evaluates today's alerts for the admin's company without sending or recording anything. */
export async function previewAlertsAction(): Promise<AlertsRunReport | { error: string }> {
  const admin = await requirePermission("users:manage");
  try {
    return await runAlerts(admin.companyId, { dryRun: true, force: true });
  } catch (e) {
    return { error: (e as Error).message };
  }
}
