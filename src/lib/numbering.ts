import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Client that works both standalone and inside a transaction (tx).
type Db = PrismaClient | Prisma.TransactionClient;

/** Next internal number for a series, e.g. "O-00000007". Derives from the current max (not a count)
 *  so deleting a record never causes a collision. Zero-padded fixed width → string order == numeric. */
async function nextNumber(db: Db, kind: "opportunity" | "project", companyId: string, prefix: string, pad: number): Promise<string> {
  const last =
    kind === "opportunity"
      ? await db.opportunity.findFirst({ where: { companyId, number: { not: null } }, orderBy: { number: "desc" }, select: { number: true } })
      : await db.project.findFirst({ where: { companyId, number: { not: null } }, orderBy: { number: "desc" }, select: { number: true } });
  const current = last?.number ? parseInt(last.number.replace(/\D/g, ""), 10) || 0 : 0;
  return `${prefix}${String(current + 1).padStart(pad, "0")}`;
}

export function nextOpportunityNumber(companyId: string, db: Db = prisma): Promise<string> {
  return nextNumber(db, "opportunity", companyId, "O-", 8);
}

export function nextProjectNumber(companyId: string, db: Db = prisma): Promise<string> {
  return nextNumber(db, "project", companyId, "PR-", 7);
}
