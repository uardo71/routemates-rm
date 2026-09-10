"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { completeActionAtSource } from "@/lib/actions-register-data";
import type { ActionSource } from "@/lib/actions-register";

const SOURCES: ActionSource[] = ["PLAN", "RAID", "STATUS", "MEETING"];

/** The inline "done" tick on the register: closes the action where it lives. */
export async function completeActionAction(input: { source: ActionSource; id: string }): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!SOURCES.includes(input.source) || !input.id) return { error: "Invalid action." };
  const r = await completeActionAtSource(user, input.source, input.id);
  if (r.error) return r;
  revalidatePath("/actions");
  revalidatePath("/delivery");
  revalidatePath("/portfolio");
  return {};
}
