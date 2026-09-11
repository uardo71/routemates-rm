"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { setActionsDone } from "@/lib/actions-register-data";

const ChangesSchema = z.object({
  changes: z.array(z.object({ source: z.enum(["PLAN", "RAID", "STATUS", "MEETING"]), id: z.string().min(1), done: z.boolean() })).min(1).max(200),
});

/** The register's Save: applies every staged tick (complete or reopen) at source, all or nothing. */
export async function saveActionChangesAction(input: z.infer<typeof ChangesSchema>): Promise<{ error?: string; saved?: number }> {
  const user = await requireUser();
  const parsed = ChangesSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid changes." };
  const r = await setActionsDone(user, parsed.data.changes);
  if (r.error) return { error: r.error };
  revalidatePath("/actions");
  revalidatePath("/delivery");
  revalidatePath("/portfolio");
  return { saved: r.saved };
}
