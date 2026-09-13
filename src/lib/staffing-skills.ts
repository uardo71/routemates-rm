import "server-only";
import { prisma } from "@/lib/prisma";

// Skills and certifications are tracked in People (the skills matrix, certification expiry alerts)
// but staffing a project has never looked at any of it — an assignment is made on availability and
// rate alone, blind to who actually knows the toolset. This is the one place that closes that gap:
// each user's top skills, for showing next to their name wherever a staffing decision gets made.

const TOP_N = 3;

/** `userId -> ["SAP FI", "ABAP", ...]`, highest level first, at most `TOP_N` per user. Users with no
 *  skills recorded are simply absent from the map — callers should treat that as "unknown", not "none". */
export async function topSkillsByUser(companyId: string, userIds: string[]): Promise<Map<string, string[]>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.userSkill.findMany({
    where: { userId: { in: userIds }, skill: { companyId } },
    select: { userId: true, level: true, skill: { select: { name: true } } },
    orderBy: [{ level: "desc" }, { skill: { name: "asc" } }],
  });
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const list = out.get(r.userId) ?? [];
    if (list.length < TOP_N) list.push(r.skill.name);
    out.set(r.userId, list);
  }
  return out;
}
