import { BackLink } from "@/components/back-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/session";
import { CreateExchangeRateForm } from "./create-exchange-rate-form";

export default async function NewExchangeRatePage() {
  await requirePermission("salaries:manage");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackLink href="/admin/exchange-rates" label="Exchange rates" />
        <h1 className="text-2xl font-semibold mt-1">New exchange rate</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Rate details</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateExchangeRateForm />
        </CardContent>
      </Card>
    </div>
  );
}
