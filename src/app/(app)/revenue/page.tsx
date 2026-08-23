import { requirePermission } from "@/lib/session";
import { computeCompanyRevenue } from "@/lib/revenue-data";
import { RevenueClient } from "./revenue-client";

export default async function RevenuePage() {
  const user = await requirePermission("reports:view");
  const { rows, overhead, monthKeys, monthLabels, companyCurrency } = await computeCompanyRevenue(user);

  return (
    <RevenueClient
      rows={rows}
      overhead={overhead}
      monthKeys={monthKeys}
      monthLabels={monthLabels}
      defaultCurrency={companyCurrency}
    />
  );
}
