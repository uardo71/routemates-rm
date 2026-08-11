import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeleteButton } from "@/components/delete-button";
import { InitialsAvatar } from "@/components/initials-avatar";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { AddCategoryForm } from "./add-category-form";
import { deleteExpenseCategoryAction } from "./actions";

export default async function ExpenseCategoriesPage() {
  const caller = await requirePermission("expenses:manage");

  const categories = await prisma.expenseCategory.findMany({
    where: { companyId: caller.companyId },
    include: { _count: { select: { expenses: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Expense categories</h1>
        <p className="text-sm text-muted-foreground">Used to group expenses for reporting (Utilities, Travel, Office supplies, etc).</p>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">
            Categories <span className="font-normal text-muted-foreground">({categories.length})</span>
          </CardTitle>
          <AddCategoryForm />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <InitialsAvatar name={c.name} />
                      <span className="font-medium">{c.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c._count.expenses > 0 ? (
                      c._count.expenses
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <DeleteButton
                      action={deleteExpenseCategoryAction.bind(null, c.id)}
                      confirmMessage={`Delete category "${c.name}"?`}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {categories.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                    No categories yet — add your first one above.
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
