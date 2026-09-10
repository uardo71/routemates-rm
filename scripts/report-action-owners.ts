/**
 * Reports how the action-owner backfill went (migration `action_owner_user` links free-text owners to
 * active users by exact, case-insensitive name): how many rows per source are linked to a person,
 * how many remain text-only (client-side people, typos, ambiguous names), and which names those are.
 *
 *   NODE_PATH=<shim with server-only> pnpm exec tsx scripts/report-action-owners.ts
 */
import { prisma } from "@/lib/prisma";

async function main() {
  const [plan, raid, status, meeting] = await Promise.all([
    prisma.planTask.findMany({ where: { owner: { not: null } }, select: { owner: true, ownerUserId: true } }),
    prisma.raidItem.findMany({ where: { owner: { not: null } }, select: { owner: true, ownerUserId: true } }),
    prisma.statusReportAction.findMany({ where: { owner: { not: null } }, select: { owner: true, ownerUserId: true } }),
    prisma.meetingActionItem.findMany({ where: { owner: { not: null } }, select: { owner: true, ownerUserId: true } }),
  ]);
  const report = (label: string, rows: { owner: string | null; ownerUserId: string | null }[]) => {
    const linked = rows.filter((r) => r.ownerUserId).length;
    const textOnly = rows.filter((r) => !r.ownerUserId);
    const names = [...new Set(textOnly.map((r) => (r.owner ?? "").trim()).filter(Boolean))].sort();
    console.log(`${label.padEnd(22)} owners: ${rows.length}  linked: ${linked}  text-only: ${textOnly.length}${names.length ? `  → ${names.join(", ")}` : ""}`);
    return { linked, textOnly: textOnly.length };
  };
  const t = [report("Plan tasks", plan), report("RAID items", raid), report("Status actions", status), report("Meeting actions", meeting)];
  console.log(`TOTAL linked: ${t.reduce((s, x) => s + x.linked, 0)}  text-only: ${t.reduce((s, x) => s + x.textOnly, 0)}`);
}
main().finally(() => prisma.$disconnect());
