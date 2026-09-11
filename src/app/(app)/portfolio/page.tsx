import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { loadDeliveryHome } from "@/lib/delivery-home";
import { loadHygiene } from "@/lib/hygiene-data";
import { PortfolioClient } from "./portfolio-client";

// The customer portfolio: every delivery workspace the caller manages, as a triage table. Same
// data model as the /delivery cockpit (see lib/delivery-home), just the workspace rows — plus the
// data-hygiene worklist for the same projects (lib/hygiene).
export default async function PortfolioPage() {
  const user = await requirePermission("delivery:manage");
  const scope = user.role === "ADMIN"
    ? ("ALL" as const)
    : (await prisma.project.findMany({ where: { companyId: user.companyId, managerId: user.id }, select: { id: true } })).map((p) => p.id);
  const [{ workspaces }, hygiene] = await Promise.all([
    loadDeliveryHome(user),
    loadHygiene(user.companyId, scope, new Date().toISOString().slice(0, 10)),
  ]);
  return <PortfolioClient workspaces={workspaces} hygiene={hygiene} isAdmin={user.role === "ADMIN"} />;
}
