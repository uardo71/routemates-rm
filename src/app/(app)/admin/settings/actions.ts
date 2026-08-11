"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/session";
import { setPasswordLoginSetting } from "@/lib/settings";

export async function setPasswordLoginAction(enabled: boolean): Promise<{ error?: string }> {
  await requirePermission("users:manage");
  await setPasswordLoginSetting(enabled);
  revalidatePath("/admin/settings");
  revalidatePath("/login");
  return {};
}
