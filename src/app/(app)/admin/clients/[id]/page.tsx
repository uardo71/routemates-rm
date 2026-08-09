import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeleteButton } from "@/components/delete-button";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { can } from "@/lib/permissions";
import { EditClientForm } from "./edit-client-form";
import { AddContactForm } from "./add-contact-form";
import { deleteContactAction } from "../actions";

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("clients:view");

  const client = await prisma.client.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      contacts: { orderBy: { createdAt: "asc" } },
      projects: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!client) notFound();

  const canManage = can(user, "clients:manage");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/clients" className="text-sm text-muted-foreground hover:underline">
          ← Clients
        </Link>
        <h1 className="text-2xl font-semibold mt-1">{client.name}</h1>
      </div>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <EditClientForm key={client.updatedAt.toISOString()} clientId={client.id} name={client.name} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Contacts</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {client.contacts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell>{c.email ?? "—"}</TableCell>
                  <TableCell>{c.phone ?? "—"}</TableCell>
                  {canManage && (
                    <TableCell>
                      <DeleteButton
                        action={deleteContactAction.bind(null, c.id)}
                        confirmMessage={`Remove contact ${c.name}?`}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {client.contacts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canManage ? 4 : 3} className="text-center text-muted-foreground">
                    No contacts yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {canManage && <AddContactForm clientId={client.id} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Billing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {client.projects.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/projects/${p.id}`} className="hover:underline">
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{p.status}</Badge>
                  </TableCell>
                  <TableCell>{p.billingType.replaceAll("_", " ")}</TableCell>
                </TableRow>
              ))}
              {client.projects.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No projects yet.
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
