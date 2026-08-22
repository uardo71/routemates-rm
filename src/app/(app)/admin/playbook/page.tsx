import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { PlaybookClient, type PlaybookRow } from "./playbook-client";

export default async function PlaybookPage() {
  const user = await requirePermission("projects:manage:any");
  const tasks = await prisma.playbookTask.findMany({ where: { companyId: user.companyId }, orderBy: { sortOrder: "asc" } });
  const rows: PlaybookRow[] = tasks.map((t) => ({
    id: t.id, phase: t.phase, title: t.title, description: t.description, offsetDays: t.offsetDays, active: t.active,
  }));
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Project playbook</h1>
        <p className="text-sm text-muted-foreground">
          The standard governance checklist applied to every new project. Editing it changes what future projects get — existing projects keep their current checklist.
        </p>
      </div>
      <PlaybookClient rows={rows} />
    </div>
  );
}
