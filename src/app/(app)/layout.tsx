import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { avatarSrc } from "@/lib/avatar";
import { type NavGroup } from "./sidebar-nav";
import { SidebarShell } from "./sidebar-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user;
  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { avatarUrl: true } });

  const groups: NavGroup[] = [
    { label: "Overview", items: [{ href: "/", label: "Dashboard", icon: "dashboard" }] },
    ...(can(user, "opportunities:view")
      ? [
          {
            label: "Sales",
            items: [{ href: "/opportunities", label: "Opportunities", icon: "opportunities" as const }],
          },
        ]
      : []),
    {
      label: "Delivery",
      items: [
        ...(can(user, "projects:view")
          ? [{ href: "/projects", label: "Projects", icon: "projects" as const }]
          : []),
        { href: "/time", label: "Time", icon: "time" as const },
        { href: "/my-planning", label: "My planning", icon: "myPlanning" as const },
        { href: "/vacations", label: "Vacations", icon: "vacations" as const },
        { href: "/expenses", label: "Expenses", icon: "expenses" as const },
        ...(user.role === "ADMIN" || user.role === "PM"
          ? [{ href: "/approvals", label: "Approvals", icon: "approvals" as const }]
          : []),
        ...(can(user, "planning:view")
          ? [
              { href: "/planning", label: "Planning", icon: "planning" as const },
              {
                href: "/admin/scheduled-vs-actuals",
                label: "Scheduled vs actuals",
                icon: "scheduledVsActuals" as const,
              },
            ]
          : []),
      ],
    },
    ...(can(user, "invoices:manage") || can(user, "salaries:manage")
      ? [
          {
            label: "Finance",
            items: [
              ...(can(user, "invoices:manage")
                ? [{ href: "/invoices", label: "Invoices", icon: "invoices" as const }]
                : []),
              ...(can(user, "salaries:manage")
                ? [{ href: "/admin/exchange-rates", label: "Exchange rates", icon: "exchangeRates" as const }]
                : []),
              ...(can(user, "taxes:manage")
                ? [{ href: "/taxes", label: "Taxes", icon: "taxes" as const }]
                : []),
              ...(can(user, "vendors:manage")
                ? [{ href: "/vendors", label: "Vendor payments", icon: "vendors" as const }]
                : []),
            ],
          },
        ]
      : []),
    ...(can(user, "reports:view")
      ? [
          {
            label: "Reports",
            items: [
              { href: "/revenue", label: "Revenue & forecast", icon: "revenue" as const },
              { href: "/budgets", label: "Budgets", icon: "budgets" as const },
            ],
          },
        ]
      : []),
    ...(can(user, "users:manage") || can(user, "clients:view")
      ? [
          {
            label: "Admin",
            items: [
              ...(can(user, "users:manage")
                ? [{ href: "/admin/users", label: "Users", icon: "users" as const }]
                : []),
              ...(can(user, "clients:view")
                ? [{ href: "/admin/clients", label: "Clients", icon: "clients" as const }]
                : []),
              ...(can(user, "users:manage")
                ? [{ href: "/admin/settings", label: "Settings", icon: "settings" as const }]
                : []),
            ],
          },
        ]
      : []),
  ];

  const cookieStore = await cookies();
  const defaultCollapsed = cookieStore.get("rm_sidebar_collapsed")?.value === "1";

  return (
    <SidebarShell
      groups={groups}
      userName={user.name ?? "User"}
      userRole={user.role}
      userAvatar={avatarSrc(me?.avatarUrl)}
      defaultCollapsed={defaultCollapsed}
    >
      {children}
    </SidebarShell>
  );
}
