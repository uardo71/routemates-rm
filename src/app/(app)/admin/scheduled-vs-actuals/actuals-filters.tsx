"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { MultiSelectFilter } from "@/components/multi-select-filter";

const ROLES = ["ADMIN", "FINANCE", "SALES", "PM", "EMPLOYEE", "CONTRACTOR"] as const;

export function ActualsFilters({
  projects,
  currentProjects,
  currentRoles,
}: {
  projects: { id: string; name: string }[];
  currentProjects: string[];
  currentRoles: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(key: string, values: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (values.length > 0) params.set(key, values.join(","));
    else params.delete(key);
    router.push(`/admin/scheduled-vs-actuals?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-3">
      <MultiSelectFilter
        label="projects"
        options={projects.map((p) => ({ value: p.id, label: p.name }))}
        selected={currentProjects}
        onChange={(values) => update("projects", values)}
      />
      <MultiSelectFilter
        label="roles"
        options={ROLES.map((r) => ({ value: r, label: r }))}
        selected={currentRoles}
        onChange={(values) => update("roles", values)}
      />
    </div>
  );
}
