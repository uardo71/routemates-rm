import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LinkButton } from "@/components/link-button";
import { InitialsAvatar } from "@/components/initials-avatar";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

export default async function ClientsAdminPage() {
  const user = await requirePermission("clients:view");

  const clients = await prisma.client.findMany({
    where: { companyId: user.companyId },
    include: { contacts: true, _count: { select: { projects: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Clients</h1>
        {can(user, "clients:manage") && <LinkButton href="/admin/clients/new">New client</LinkButton>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            All clients <span className="font-normal text-muted-foreground">({clients.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Primary contact</TableHead>
                <TableHead className="text-right">Projects</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <InitialsAvatar name={c.name} />
                      <Link href={`/admin/clients/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.contacts[0] ? `${c.contacts[0].name}${c.contacts[0].email ? ` (${c.contacts[0].email})` : ""}` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c._count.projects > 0 ? c._count.projects : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ))}
              {clients.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                    No clients yet.
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
