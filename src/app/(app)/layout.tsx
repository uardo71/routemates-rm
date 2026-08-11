import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { can } from "@/lib/permissions";
import { SidebarNav, type NavGroup } from "./sidebar-nav";
import { UserMenu } from "./user-menu";
import { RoutematesLogo } from "@/components/routemates-logo";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user;

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
              ...(can(user, "expenses:manage")
                ? [{ href: "/admin/expense-categories", label: "Expense categories", icon: "expenseCategories" as const }]
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

  return (
    <div className="flex flex-1 min-h-full">
      <aside className="w-60 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col">
        <div className="px-4 py-4">
          <RoutematesLogo className="h-9" />
        </div>
        <div className="flex-1 overflow-auto py-1">
          <SidebarNav groups={groups} />
        </div>
        <div className="border-t border-sidebar-border p-2">
          <UserMenu name={user.name ?? "User"} role={user.role} />
        </div>
      </aside>
      <main className="flex-1 overflow-auto bg-background p-6">
        <div className="w-full">{children}</div>
      </main>
    </div>
  );
}
