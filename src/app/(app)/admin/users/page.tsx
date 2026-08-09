import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LinkButton } from "@/components/link-button";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { formatMoney } from "@/lib/format";

export default async function UsersAdminPage() {
  const user = await requirePermission("users:manage");

  const users = await prisma.user.findMany({
    where: { companyId: user.companyId },
    include: { employment: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        <LinkButton href="/admin/users/new">New user</LinkButton>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team members</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Cost rate</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                      {u.name}
                    </Link>
                  </TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{u.role}</Badge>
                  </TableCell>
                  <TableCell>
                    {u.employment ? `${formatMoney(u.employment.costRate, "EUR")}/hr` : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.active ? "default" : "outline"}>
                      {u.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
