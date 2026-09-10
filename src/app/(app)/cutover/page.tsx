import Link from "next/link";
import { RocketIcon, ArrowRightIcon, LayersIcon, PlusIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { engagementScope, visibleProjectIds } from "@/lib/permissions";
import { InitialsAvatar } from "@/components/initials-avatar";

export const metadata = { title: "Cutover plans" };

// Every cutover plan across the projects the user is on, grouped by project and end customer.
// Consultants scoped to specific end customers see only those (plus project-level plans).
export default async function CutoverIndexPage() {
  const user = await requireUser();
  const ids = await visibleProjectIds(user);
  const where =
    ids === "ALL"
      ? { companyId: user.companyId, isInternal: false }
      : { companyId: user.companyId, isInternal: false, id: { in: ids } };

  const projects = await prisma.project.findMany({
    where,
    select: {
      id: true, name: true, number: true, client: { select: { name: true } },
      engagements: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true } },
      cutoverPlans: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, engagementId: true, tasks: { select: { id: true, parentId: true, status: true } } },
      },
    },
    orderBy: { name: "asc" },
  });

  const rows = await Promise.all(
    projects.map(async (p) => {
      const scope = await engagementScope(user, p.id);
      const allowed = (engagementId: string | null) => scope === "ALL" || engagementId === null || scope.includes(engagementId);
      return {
        ...p,
        engagements: p.engagements.filter((e) => allowed(e.id)),
        cutoverPlans: p.cutoverPlans.filter((c) => allowed(c.engagementId)),
      };
    }),
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cutover plans</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Go-live runbooks for the projects you&apos;re on — one per end customer, phase or wave. Plan the cutover to production and export it for the customer and all providers.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          You&apos;re not assigned to any projects yet.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((p) => {
            const engName = new Map(p.engagements.map((e) => [e.id, e.name]));
            return (
              <section key={p.id} className="rounded-xl border bg-card">
                <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
                  <InitialsAvatar name={p.client.name} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{p.client.name}{p.number ? ` · ${p.number}` : ""}</div>
                  </div>
                  <Link href={`/delivery/${p.id}/cutover`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    <PlusIcon className="size-3.5" /> New plan / manage
                  </Link>
                </div>
                {p.cutoverPlans.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-muted-foreground">No cutover plan yet.</p>
                ) : (
                  <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
                    {p.cutoverPlans.map((c) => {
                      const leaves = c.tasks.filter((t) => !c.tasks.some((k) => k.parentId === t.id));
                      const done = leaves.filter((t) => t.status === "DONE" || t.status === "SKIPPED").length;
                      return (
                        <Link key={c.id} href={`/delivery/${p.id}/cutover/${c.id}`} className="group flex items-center gap-3 rounded-lg border p-3 transition-all hover:border-primary/40 hover:shadow-sm">
                          <RocketIcon className="size-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{c.name}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1"><LayersIcon className="size-3" />{c.engagementId ? engName.get(c.engagementId) ?? "End customer" : "Project overall"}</span>
                              <span>· {leaves.length > 0 ? `${done}/${leaves.length} steps done` : "No steps yet"}</span>
                            </div>
                          </div>
                          <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground/40 group-hover:text-primary" />
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
