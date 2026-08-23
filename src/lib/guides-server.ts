import "server-only";
import { prisma } from "@/lib/prisma";
import { DEFAULT_GUIDES } from "@/lib/guides";

/** Seed the default coaching library for a company the first time it's needed.
 *  Idempotent: only seeds when the company has no guides at all. */
export async function ensureGuidesSeeded(companyId: string): Promise<void> {
  const existing = await prisma.sopGuide.count({ where: { companyId } });
  if (existing > 0) return;
  await prisma.sopGuide.createMany({
    data: DEFAULT_GUIDES.map((g, i) => ({
      companyId,
      title: g.title,
      category: g.category,
      summary: g.summary,
      steps: g.steps.join("\n"),
      source: g.source,
      sortOrder: i,
    })),
  });
}

export type Guide = {
  id: string;
  title: string;
  category: string;
  summary: string | null;
  steps: string[];
  source: string | null;
  active: boolean;
  sortOrder: number;
};

function toGuide(row: {
  id: string;
  title: string;
  category: string;
  summary: string | null;
  steps: string;
  source: string | null;
  active: boolean;
  sortOrder: number;
}): Guide {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    summary: row.summary,
    steps: row.steps.split("\n").map((s) => s.trim()).filter(Boolean),
    source: row.source,
    active: row.active,
    sortOrder: row.sortOrder,
  };
}

/** Active guides for the cockpit help dialog. Seeds defaults on first use. */
export async function getActiveGuides(companyId: string): Promise<Guide[]> {
  await ensureGuidesSeeded(companyId);
  const rows = await prisma.sopGuide.findMany({
    where: { companyId, active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toGuide);
}

/** All guides (incl. inactive) for the admin manager. Seeds defaults on first use. */
export async function getAllGuides(companyId: string): Promise<Guide[]> {
  await ensureGuidesSeeded(companyId);
  const rows = await prisma.sopGuide.findMany({
    where: { companyId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toGuide);
}
