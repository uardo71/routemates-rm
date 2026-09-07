import Link from "next/link";
import { format } from "date-fns";
import { notFound } from "next/navigation";
import {
  MailIcon,
  PhoneIcon,
  MapPinIcon,
  ClockIcon,
  BriefcaseIcon,
  CheckSquareIcon,
  FolderKanbanIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeleteButton } from "@/components/delete-button";
import { InitialsAvatar } from "@/components/initials-avatar";
import { RoleBadge } from "@/components/role-badge";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { computeHourlyCostRateEUR } from "@/lib/cost-rate";
import { formatMoney } from "@/lib/format";
import { avatarSrc } from "@/lib/avatar";
import { EditUserForm } from "./edit-user-form";
import { AddSalaryForm } from "./add-salary-form";
import { deleteSalaryAction } from "../salary-actions";

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const currentUser = await requirePermission("users:manage");

  const target = await prisma.user.findFirst({
    where: { id, companyId: currentUser.companyId },
    include: { employment: true },
  });
  if (!target) notFound();
  // Customer portal users are managed from their client page, not the staff directory.
  if (target.role === "CUSTOMER") notFound();

  const [timeEntries, assignments, approvals, managedProjects, salaries, computedRate] = await Promise.all([
    prisma.timeEntry.count({ where: { userId: id } }),
    prisma.assignment.count({ where: { userId: id } }),
    prisma.timeCard.count({ where: { approverId: id } }),
    prisma.project.count({ where: { managerId: id } }),
    prisma.salary.findMany({ where: { userId: id }, orderBy: { effectiveFrom: "desc" } }),
    computeHourlyCostRateEUR(id),
  ]);

  const canDelete =
    target.id !== currentUser.id && timeEntries + assignments + approvals + managedProjects === 0;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin/users" className="text-sm text-muted-foreground hover:underline">
        ← Users
      </Link>

      {/* Profile header */}
      <Card className="gap-0 overflow-hidden p-0">
        <div className="h-20 bg-gradient-to-r from-primary/25 via-primary/10 to-transparent" />
        <div className="-mt-10 flex flex-col gap-4 px-6 pb-6 sm:flex-row sm:items-end sm:gap-5">
          <InitialsAvatar
            name={target.name}
            src={avatarSrc(target.avatarUrl)}
            size="lg"
            className="ring-4 ring-card shadow-paper"
          />
          <div className="flex flex-1 flex-col gap-2 pt-1 sm:pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-xl font-semibold">{target.name}</h1>
              <RoleBadge role={target.role} />
              {target.active ? (
                <Badge variant="secondary">Active</Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Inactive
                </Badge>
              )}
            </div>
            {target.title && <p className="text-sm font-medium text-muted-foreground">{target.title}</p>}
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <MailIcon className="size-3.5" /> {target.email}
              </span>
              {target.phone && (
                <span className="flex items-center gap-1.5">
                  <PhoneIcon className="size-3.5" /> {target.phone}
                </span>
              )}
              {target.location && (
                <span className="flex items-center gap-1.5">
                  <MapPinIcon className="size-3.5" /> {target.location}
                </span>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Activity */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Assignments" value={assignments} icon={BriefcaseIcon} />
        <StatCard label="Time entries" value={timeEntries} icon={ClockIcon} />
        <StatCard label="Approvals given" value={approvals} icon={CheckSquareIcon} />
        <StatCard label="Projects managed" value={managedProjects} icon={FolderKanbanIcon} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Manage user</CardTitle>
        </CardHeader>
        <CardContent>
          <EditUserForm
            key={`${target.updatedAt.toISOString()}:${target.employment?.updatedAt.toISOString() ?? ""}`}
            user={{
              id: target.id,
              name: target.name,
              email: target.email,
              role: target.role,
              active: target.active,
              title: target.title,
              phone: target.phone,
              location: target.location,
              canDelete,
              employment: target.employment
                ? {
                    costRate: target.employment.costRate.toString(),
                    costRateIsComputed: computedRate !== null,
                    startDate: target.employment.startDate.toISOString().slice(0, 10),
                    endDate: target.employment.endDate?.toISOString().slice(0, 10) ?? null,
                    carriedInVacationDays: target.employment.carriedInVacationDays?.toString() ?? null,
                    carriedInVacationYear: target.employment.carriedInVacationYear ?? null,
                  }
                : null,
            }}
          />
        </CardContent>
      </Card>

      {target.employment && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Salary history</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              The cost rate shown above is always derived from whichever row here is effective as of today —
              add a new row (with an effective date) whenever salary changes, rather than editing an old one, so
              historical cost basis stays accurate.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Effective from</TableHead>
                  <TableHead>Monthly amount</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {salaries.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{format(s.effectiveFrom, "MMM d, yyyy")}</TableCell>
                    <TableCell>{formatMoney(s.monthlyAmount, s.currency)}</TableCell>
                    <TableCell>{s.currency}</TableCell>
                    <TableCell>
                      <DeleteButton
                        action={deleteSalaryAction.bind(null, s.id)}
                        confirmMessage="Remove this salary record?"
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {salaries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No salary on file yet — cost rate is using the job title default.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <AddSalaryForm userId={target.id} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
