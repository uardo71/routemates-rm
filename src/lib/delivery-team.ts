import "server-only";
import { prisma } from "@/lib/prisma";

// The people actually delivering a client's work (Assignment, on a Milestone of one of the
// client's projects) and the people on that client's Support team (ClientTeamMember) are two
// separate rosters with no shared code path — someone has to notice by hand that the consultants
// running the project should also be on the account's support team once it goes live. This is the
// one place that bridges them: who's actively staffed on this client's projects right now.
export async function deliveryStaffForClient(companyId: string, clientId: string): Promise<{ id: string; name: string }[]> {
  const assignments = await prisma.assignment.findMany({
    where: {
      status: "ACTIVE",
      milestone: { project: { companyId, clientId, isInternal: false } },
    },
    select: { user: { select: { id: true, name: true } } },
    distinct: ["userId"],
  });
  return assignments.map((a) => a.user).sort((a, b) => a.name.localeCompare(b.name));
}
