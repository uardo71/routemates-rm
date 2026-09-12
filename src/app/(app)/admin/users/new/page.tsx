import { BackLink } from "@/components/back-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/session";
import { CreateUserForm } from "./create-user-form";

export default async function NewUserPage() {
  await requirePermission("users:manage");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackLink href="/admin/users" label="Users" />
        <h1 className="text-2xl font-semibold mt-1">New user</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>User details</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateUserForm />
        </CardContent>
      </Card>
    </div>
  );
}
