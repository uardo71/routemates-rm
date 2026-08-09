"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ROLES = ["ADMIN", "FINANCE", "SALES", "PM", "EMPLOYEE", "CONTRACTOR"] as const;

export function PlannerFilters({
  projects,
  currentProject,
  currentRole,
}: {
  projects: { id: string; name: string }[];
  currentProject?: string;
  currentRole?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/planning?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-3">
      <Select
        value={currentProject ?? "__all__"}
        items={[{ value: "__all__", label: "All projects" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
        onValueChange={(v) => update("project", v === "__all__" ? null : v)}
      >
        <SelectTrigger className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All projects</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={currentRole ?? "__all__"}
        items={[{ value: "__all__", label: "All roles" }, ...ROLES.map((r) => ({ value: r, label: r }))]}
        onValueChange={(v) => update("role", v === "__all__" ? null : v)}
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All roles</SelectItem>
          {ROLES.map((r) => (
            <SelectItem key={r} value={r}>
              {r}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
