import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeleteButton } from "@/components/delete-button";
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
        <CardHeader>
          <CardTitle className="text-base">Add category</CardTitle>
        </CardHeader>
        <CardContent>
          <AddCategoryForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All categories</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Expenses</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="tabular-nums">{c._count.expenses}</TableCell>
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
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No categories yet.
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
