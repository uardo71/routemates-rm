import { requirePermission } from "@/lib/session";
import { loadDeliveryHome } from "@/lib/delivery-home";
import { PortfolioClient } from "./portfolio-client";

// The customer portfolio: every delivery workspace the caller manages, as a triage table. Same
// data model as the /delivery cockpit (see lib/delivery-home), just the workspace rows.
export default async function PortfolioPage() {
  const user = await requirePermission("delivery:manage");
  const { workspaces } = await loadDeliveryHome(user);
  return <PortfolioClient workspaces={workspaces} isAdmin={user.role === "ADMIN"} />;
}
