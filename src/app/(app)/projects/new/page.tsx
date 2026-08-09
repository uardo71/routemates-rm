import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { CreateProjectForm } from "./create-project-form";

export default async function NewProjectPage() {
  const user = await requirePermission("projects:create");

  const [clients, managers] = await Promise.all([
    prisma.client.findMany({ where: { companyId: user.companyId }, orderBy: { name: "asc" } }),
    user.role === "ADMIN"
      ? prisma.user.findMany({ where: { companyId: user.companyId, role: "PM", active: true }, orderBy: { name: "asc" } })
      : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/projects" className="text-sm text-muted-foreground hover:underline">
          ← Projects
        </Link>
        <h1 className="text-2xl font-semibold mt-1">New project</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Project details</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateProjectForm
            clients={clients.map((c) => ({ id: c.id, name: c.name }))}
            managers={managers ? managers.map((m) => ({ id: m.id, name: m.name })) : null}
          />
        </CardContent>
      </Card>
    </div>
  );
}
