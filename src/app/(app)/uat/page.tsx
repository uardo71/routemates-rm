import Link from "next/link";
import { ClipboardCheckIcon, ArrowRightIcon, LayersIcon, PlusIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { engagementScope, visibleProjectIds } from "@/lib/permissions";
import { InitialsAvatar } from "@/components/initials-avatar";
import { UAT_SCRIPT_STATUS_LABEL, UAT_SCRIPT_STATUS_TONE } from "@/lib/uat";
import { cn } from "@/lib/utils";

export const metadata = { title: "UAT test scripts" };

// Every UAT test script across the projects the user is on, grouped by project and end customer.
export default async function UatIndexPage() {
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
      uatScripts: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, engagementId: true, status: true, _count: { select: { cases: true } } },
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
        uatScripts: p.uatScripts.filter((s) => allowed(s.engagementId)),
      };
    }),
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">UAT test scripts</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Customer test scripts for the projects you&apos;re on — one per end customer or test phase; scenarios and results per functional area, exportable to Excel.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">You&apos;re not assigned to any projects yet.</div>
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
                  <Link href={`/delivery/${p.id}/uat`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    <PlusIcon className="size-3.5" /> New script / manage
                  </Link>
                </div>
                {p.uatScripts.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-muted-foreground">No test script yet.</p>
                ) : (
                  <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
                    {p.uatScripts.map((s) => (
                      <Link key={s.id} href={`/delivery/${p.id}/uat/${s.id}`} className="group flex items-center gap-3 rounded-lg border p-3 transition-all hover:border-primary/40 hover:shadow-sm">
                        <ClipboardCheckIcon className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{s.name}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span className={cn("rounded-full px-2 py-0.5 font-medium", UAT_SCRIPT_STATUS_TONE[s.status])}>{UAT_SCRIPT_STATUS_LABEL[s.status]}</span>
                            <span className="inline-flex items-center gap-1"><LayersIcon className="size-3" />{s.engagementId ? engName.get(s.engagementId) ?? "End customer" : "Project overall"}</span>
                            <span>· {s._count.cases} case{s._count.cases === 1 ? "" : "s"}</span>
                          </div>
                        </div>
                        <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground/40 group-hover:text-primary" />
                      </Link>
                    ))}
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
