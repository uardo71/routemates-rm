import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/session";
import { CreateClientForm } from "./create-client-form";

export default async function NewClientPage() {
  await requirePermission("clients:manage");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/clients" className="text-sm text-muted-foreground hover:underline">
          ← Clients
        </Link>
        <h1 className="text-2xl font-semibold mt-1">New client</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Client details</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateClientForm />
        </CardContent>
      </Card>
    </div>
  );
}
