import { cn } from "@/lib/utils";

// Color-coded role chips, shared by the users list, user detail, and profile so a role always
// reads the same everywhere. Literal classes (not built at runtime) so Tailwind compiles them.
const ROLE_STYLE: Record<string, { label: string; className: string }> = {
  ADMIN: { label: "Admin", className: "bg-rose-500/12 text-rose-700 ring-rose-500/25 dark:text-rose-400" },
  FINANCE: { label: "Finance", className: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-400" },
  SALES: { label: "Sales", className: "bg-violet-500/12 text-violet-700 ring-violet-500/25 dark:text-violet-400" },
  PM: { label: "Project Manager", className: "bg-blue-500/12 text-blue-700 ring-blue-500/25 dark:text-blue-400" },
  EMPLOYEE: { label: "Employee", className: "bg-slate-500/12 text-slate-700 ring-slate-500/25 dark:text-slate-300" },
  CONTRACTOR: { label: "Contractor", className: "bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-400" },
};

export function RoleBadge({ role, className }: { role: string; className?: string }) {
  const s = ROLE_STYLE[role] ?? { label: role, className: "bg-muted text-foreground ring-border" };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap",
        s.className,
        className
      )}
    >
      {s.label}
    </span>
  );
}
