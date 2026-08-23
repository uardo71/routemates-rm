import Link from "next/link";
import { RocketIcon, ArrowRightIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { visibleProjectIds } from "@/lib/permissions";
import { InitialsAvatar } from "@/components/initials-avatar";

export const metadata = { title: "Cutover plans" };

export default async function CutoverIndexPage() {
  const user = await requireUser();
  const ids = await visibleProjectIds(user);
  const where =
    ids === "ALL"
      ? { companyId: user.companyId, isInternal: false }
      : { companyId: user.companyId, isInternal: false, id: { in: ids } };

  const projects = await prisma.project.findMany({
    where,
    select: { id: true, name: true, number: true, client: { select: { name: true } }, _count: { select: { cutoverTasks: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cutover plans</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Go-live runbooks for the projects you&apos;re on — plan the cutover to production and export it for the customer and all providers.
        </p>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          You&apos;re not assigned to any projects yet.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/delivery/${p.id}/cutover`} className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-sm">
              <InitialsAvatar name={p.client.name} size="md" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.name}</div>
                <div className="truncate text-xs text-muted-foreground">{p.client.name}{p.number ? ` · ${p.number}` : ""}</div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <RocketIcon className="size-3.5" />
                  {p._count.cutoverTasks > 0 ? `${p._count.cutoverTasks} step${p._count.cutoverTasks === 1 ? "" : "s"}` : "No plan yet"}
                </div>
              </div>
              <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground/40 group-hover:text-primary" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
