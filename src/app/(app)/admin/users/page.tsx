import Link from "next/link";
import { format } from "date-fns";
import { UsersIcon, UserCheckIcon, BriefcaseIcon, CoinsIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LinkButton } from "@/components/link-button";
import { InitialsAvatar } from "@/components/initials-avatar";
import { RoleBadge } from "@/components/role-badge";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { STAFF_ONLY } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { formatMoney } from "@/lib/format";
import { avatarSrc } from "@/lib/avatar";

export default async function UsersAdminPage() {
  const user = await requirePermission("users:manage");

  const users = await prisma.user.findMany({
    // Portal accounts are managed on their client's page, and this list's detail route 404s
    // for them — so they don't belong here either.
    where: { companyId: user.companyId, ...STAFF_ONLY },
    include: { employment: true },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  const total = users.length;
  const activeCount = users.filter((u) => u.active).length;
  const tracked = users.filter((u) => u.employment);
  const rates = tracked.map((u) => Number(u.employment!.costRate)).filter((r) => r > 0);
  const avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground">Everyone with access to RM Ops.</p>
        </div>
        <LinkButton href="/admin/users/new">New user</LinkButton>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Team members" value={total} icon={UsersIcon} />
        <StatCard label="Active" value={activeCount} sublabel={`${total - activeCount} inactive`} icon={UserCheckIcon} />
        <StatCard label="On payroll" value={tracked.length} sublabel="cost rate tracked" icon={BriefcaseIcon} />
        <StatCard
          label="Avg cost rate"
          value={avgRate > 0 ? `${formatMoney(avgRate, "EUR")}/hr` : "—"}
          sublabel={rates.length ? `across ${rates.length}` : "no rates yet"}
          icon={CoinsIcon}
        />
      </div>

      <Card size="sm">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Employed</TableHead>
                <TableHead className="text-right">Cost rate</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} className="group/row">
                  <TableCell>
                    <Link href={`/admin/users/${u.id}`} className="flex items-center gap-3">
                      <InitialsAvatar name={u.name} src={avatarSrc(u.avatarUrl)} size="md" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium group-hover/row:underline">{u.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{u.title ?? "—"}</span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={u.role} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {u.employment ? format(u.employment.startDate, "MMM yyyy") : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {u.employment && Number(u.employment.costRate) > 0 ? (
                      `${formatMoney(u.employment.costRate, "EUR")}/hr`
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {u.active ? (
                      <Badge variant="secondary">Active</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Inactive
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No users yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
