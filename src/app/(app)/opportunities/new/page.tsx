import { BackLink } from "@/components/back-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { CreateOpportunityForm } from "./create-opportunity-form";

export default async function NewOpportunityPage() {
  const user = await requirePermission("opportunities:manage");

  const [clients, owners, company] = await Promise.all([
    prisma.client.findMany({ where: { companyId: user.companyId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    // Anyone who can own a deal: the manage-capable roles.
    prisma.user.findMany({
      where: { companyId: user.companyId, active: true, role: { in: ["ADMIN", "PM", "SALES"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.company.findUnique({ where: { id: user.companyId }, select: { currency: true } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackLink href="/opportunities" label="Opportunities" />
        <h1 className="text-2xl font-semibold mt-1">New opportunity</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Deal details</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateOpportunityForm
            clients={clients}
            owners={owners}
            callerId={user.id}
            defaultCurrency={company?.currency ?? "USD"}
          />
        </CardContent>
      </Card>
    </div>
  );
}
