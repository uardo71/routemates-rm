import Link from "next/link";
import { ClipboardCheckIcon, ArrowRightIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { visibleProjectIds } from "@/lib/permissions";
import { InitialsAvatar } from "@/components/initials-avatar";
import { UAT_SCRIPT_STATUS_LABEL, UAT_SCRIPT_STATUS_TONE } from "@/lib/uat";
import { cn } from "@/lib/utils";

export const metadata = { title: "UAT test scripts" };

export default async function UatIndexPage() {
  const user = await requireUser();
  const ids = await visibleProjectIds(user);
  const where =
    ids === "ALL"
      ? { companyId: user.companyId, isInternal: false }
      : { companyId: user.companyId, isInternal: false, id: { in: ids } };

  const projects = await prisma.project.findMany({
    where,
    select: { id: true, name: true, number: true, uatScriptStatus: true, client: { select: { name: true } }, _count: { select: { uatTestCases: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">UAT test scripts</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Prepare the customer test scripts for the projects you&apos;re on — scenarios and results, per functional area, exportable to Excel.
        </p>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">You&apos;re not assigned to any projects yet.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/delivery/${p.id}/uat`} className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-sm">
              <InitialsAvatar name={p.client.name} size="md" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.name}</div>
                <div className="truncate text-xs text-muted-foreground">{p.client.name}{p.number ? ` · ${p.number}` : ""}</div>
                <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className={cn("rounded-full px-2 py-0.5 font-medium", UAT_SCRIPT_STATUS_TONE[p.uatScriptStatus])}>{UAT_SCRIPT_STATUS_LABEL[p.uatScriptStatus]}</span>
                  <span className="inline-flex items-center gap-1"><ClipboardCheckIcon className="size-3.5" />{p._count.uatTestCases} case{p._count.uatTestCases === 1 ? "" : "s"}</span>
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
