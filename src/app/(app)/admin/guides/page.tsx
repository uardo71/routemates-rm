import { requirePermission } from "@/lib/session";
import { getAllGuides } from "@/lib/guides-server";
import { GuidesManager } from "./guides-manager";

export const metadata = { title: "Coaching guides" };

export default async function GuidesAdminPage() {
  const user = await requirePermission("users:manage");
  const guides = await getAllGuides(user.companyId);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Coaching guides</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Short &ldquo;how do I handle this?&rdquo; playbooks drawn from our ways of working. They appear as help in the
          Delivery cockpit — so a PM always has a next step, without any bureaucracy. Edit them to match how we actually work.
        </p>
      </div>
      <GuidesManager guides={guides} />
    </div>
  );
}
