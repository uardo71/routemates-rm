import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/session";
import { CreateExchangeRateForm } from "./create-exchange-rate-form";

export default async function NewExchangeRatePage() {
  await requirePermission("salaries:manage");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/exchange-rates" className="text-sm text-muted-foreground hover:underline">
          ← Exchange rates
        </Link>
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
