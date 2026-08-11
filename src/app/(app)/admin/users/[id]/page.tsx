import Link from "next/link";
import { format } from "date-fns";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeleteButton } from "@/components/delete-button";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { computeHourlyCostRateEUR } from "@/lib/cost-rate";
import { formatMoney } from "@/lib/format";
import { EditUserForm } from "./edit-user-form";
import { AddSalaryForm } from "./add-salary-form";
import { deleteSalaryAction } from "../salary-actions";

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const currentUser = await requirePermission("users:manage");

  const target = await prisma.user.findFirst({
    where: { id, companyId: currentUser.companyId },
    include: { employment: true },
  });
  if (!target) notFound();

  const [timeEntries, assignments, approvals, managedProjects, salaries, computedRate] = await Promise.all([
    prisma.timeEntry.count({ where: { userId: id } }),
    prisma.assignment.count({ where: { userId: id } }),
    prisma.timeCard.count({ where: { approverId: id } }),
    prisma.project.count({ where: { managerId: id } }),
    prisma.salary.findMany({ where: { userId: id }, orderBy: { effectiveFrom: "desc" } }),
    computeHourlyCostRateEUR(id),
  ]);

  const canDelete =
    target.id !== currentUser.id && timeEntries + assignments + approvals + managedProjects === 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/users" className="text-sm text-muted-foreground hover:underline">
          ← Users
        </Link>
        <h1 className="text-2xl font-semibold mt-1">{target.name}</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>User details</CardTitle>
        </CardHeader>
        <CardContent>
          <EditUserForm
            key={`${target.updatedAt.toISOString()}:${target.employment?.updatedAt.toISOString() ?? ""}`}
            user={{
              id: target.id,
              name: target.name,
              email: target.email,
              role: target.role,
              active: target.active,
              canDelete,
              employment: target.employment
                ? {
                    costRate: target.employment.costRate.toString(),
                    costRateIsComputed: computedRate !== null,
                    startDate: target.employment.startDate.toISOString().slice(0, 10),
                    endDate: target.employment.endDate?.toISOString().slice(0, 10) ?? null,
                    carriedInVacationDays: target.employment.carriedInVacationDays?.toString() ?? null,
                    carriedInVacationYear: target.employment.carriedInVacationYear ?? null,
                  }
                : null,
            }}
          />
        </CardContent>
      </Card>

      {target.employment && (
        <Card>
          <CardHeader>
            <CardTitle>Salary history</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              The cost rate shown above is always derived from whichever row here is effective as of today —
              add a new row (with an effective date) whenever salary changes, rather than editing an old one, so
              historical cost basis stays accurate.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Effective from</TableHead>
                  <TableHead>Monthly amount</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {salaries.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{format(s.effectiveFrom, "MMM d, yyyy")}</TableCell>
                    <TableCell>{formatMoney(s.monthlyAmount, s.currency)}</TableCell>
                    <TableCell>{s.currency}</TableCell>
                    <TableCell>
                      <DeleteButton
                        action={deleteSalaryAction.bind(null, s.id)}
                        confirmMessage="Remove this salary record?"
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {salaries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No salary on file yet — cost rate is using the job title default.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <AddSalaryForm userId={target.id} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
