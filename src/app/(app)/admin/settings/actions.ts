"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/session";
import { setPasswordLoginSetting, setTimesheetNudgeConfig } from "@/lib/settings";

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
