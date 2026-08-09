"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { MultiSelectFilter } from "@/components/multi-select-filter";

const STATUSES = ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
const BILLING_TYPES = ["TIME_AND_MATERIALS", "FIXED_PRICE", "RETAINER"] as const;

export function ProjectsFilters({
  clients,
  managers,
  currentStatuses,
  currentClients,
  currentManagers,
  currentBilling,
}: {
  clients: { id: string; name: string }[];
  managers: { id: string; name: string }[];
  currentStatuses: string[];
  currentClients: string[];
  currentManagers: string[];
  currentBilling: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(key: string, values: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (values.length > 0) params.set(key, values.join(","));
    else params.delete(key);
    router.push(`/projects?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <MultiSelectFilter
        label="statuses"
        options={STATUSES.map((s) => ({ value: s, label: s.replaceAll("_", " ") }))}
        selected={currentStatuses}
        onChange={(v) => update("statuses", v)}
      />
      <MultiSelectFilter
        label="clients"
        options={clients.map((c) => ({ value: c.id, label: c.name }))}
        selected={currentClients}
        onChange={(v) => update("clients", v)}
      />
      <MultiSelectFilter
        label="managers"
        options={managers.map((m) => ({ value: m.id, label: m.name }))}
        selected={currentManagers}
        onChange={(v) => update("managers", v)}
      />
      <MultiSelectFilter
        label="billing types"
        options={BILLING_TYPES.map((b) => ({ value: b, label: b.replaceAll("_", " ") }))}
        selected={currentBilling}
        onChange={(v) => update("billing", v)}
      />
    </div>
  );
}
