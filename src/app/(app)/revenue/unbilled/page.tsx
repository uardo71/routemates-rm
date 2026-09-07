import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { loadUnbilledEntries } from "@/lib/wip-data";
import { UnbilledClient } from "./unbilled-client";

export const metadata = { title: "Unbilled work" };

export default async function UnbilledPage() {
  const user = await requirePermission("reports:view");
  const [entries, company] = await Promise.all([
    loadUnbilledEntries(user),
    prisma.company.findUnique({ where: { id: user.companyId }, select: { currency: true } }),
  ]);

  return <UnbilledClient entries={entries} currency={company?.currency ?? "EUR"} />;
}
