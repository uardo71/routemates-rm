import { requirePermission } from "@/lib/session";
import { can } from "@/lib/permissions";
import { computeCompanyRevenue } from "@/lib/revenue-data";
import { computeConsultantRealization } from "@/lib/realization-data";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FxWarning } from "@/components/fx-warning";
import { RevenueClient } from "./revenue-client";
import { ConsultantsTab } from "./consultants-tab";

export default async function RevenuePage() {
  const user = await requirePermission("reports:view");
  const { rows, overhead, monthKeys, monthLabels, companyCurrency, excluded } = await computeCompanyRevenue(user);

  // Per-consultant realization exposes cost/margin/rate — computed and rendered ONLY for
  // rates:view:any. Non-privileged reports:view users never get this data through any query path.
  const canSeeRates = can(user, "rates:view:any");
  const realization = canSeeRates ? await computeConsultantRealization(user) : null;

  const projects = (
    <RevenueClient rows={rows} overhead={overhead} monthKeys={monthKeys} monthLabels={monthLabels} defaultCurrency={companyCurrency} />
  );

  return (
    <div className="flex flex-col gap-4">
      <FxWarning excluded={excluded} noun="recognized invoices" reporting={companyCurrency} />
      {realization ? (
        <Tabs defaultValue="projects" className="gap-5">
          <TabsList>
            <TabsTrigger value="projects">By project</TabsTrigger>
            <TabsTrigger value="consultants">Per consultant</TabsTrigger>
          </TabsList>
          <TabsContent value="projects">{projects}</TabsContent>
          <TabsContent value="consultants">
            <ConsultantsTab periods={realization.periods} byPeriod={realization.byPeriod} currency={companyCurrency} />
          </TabsContent>
        </Tabs>
      ) : (
        projects
      )}
    </div>
  );
}
