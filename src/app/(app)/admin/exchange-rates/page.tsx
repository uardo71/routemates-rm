import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LinkButton } from "@/components/link-button";
import { DeleteButton } from "@/components/delete-button";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { formatNumber } from "@/lib/format";
import { deleteExchangeRateAction } from "./actions";

export default async function ExchangeRatesPage() {
  await requirePermission("salaries:manage");

  const rates = await prisma.exchangeRate.findMany({
    orderBy: [{ fromCurrency: "asc" }, { toCurrency: "asc" }, { effectiveFrom: "desc" }],
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Exchange rates</h1>
          <p className="text-sm text-muted-foreground">
            Used to convert salaries into EUR for cost-rate calculations. Add a new row (with an effective date)
            whenever a rate changes — don&apos;t edit an old one, so past cost calculations stay historically accurate.
          </p>
        </div>
        <LinkButton href="/admin/exchange-rates/new">New exchange rate</LinkButton>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All rates</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Effective from</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.fromCurrency}</TableCell>
                  <TableCell>{r.toCurrency}</TableCell>
                  <TableCell>
                    {formatNumber(r.rate, 6)} {r.fromCurrency} = 1 {r.toCurrency}
                  </TableCell>
                  <TableCell>{format(r.effectiveFrom, "MMM d, yyyy")}</TableCell>
                  <TableCell>
                    <DeleteButton
                      action={deleteExchangeRateAction.bind(null, r.id)}
                      confirmMessage="Remove this exchange rate?"
                    />
                  </TableCell>
                </TableRow>
              ))}
              {rates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No exchange rates yet — salaries in non-EUR currencies can&apos;t be converted until one is added.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
