"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelectFilter } from "@/components/multi-select-filter";

const ROLES = ["ADMIN", "FINANCE", "SALES", "PM", "EMPLOYEE", "CONTRACTOR"] as const;

export function AvailabilityFilters({
  currentRoles,
  currentWeeks,
  currentMinFree,
  maxWeeks,
}: {
  currentRoles: string[];
  currentWeeks: number;
  currentMinFree: number;
  maxWeeks: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/planning/availability?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Role</Label>
        <MultiSelectFilter
          label="roles"
          options={ROLES.map((r) => ({ value: r, label: r }))}
          selected={currentRoles}
          onChange={(values) => update("roles", values.join(","))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="weeks" className="text-xs text-muted-foreground">Weeks shown</Label>
        <Input
          id="weeks"
          type="number"
          min={1}
          max={maxWeeks}
          defaultValue={currentWeeks}
          className="w-24"
          onBlur={(e) => {
            const v = Math.min(maxWeeks, Math.max(1, Number(e.target.value) || currentWeeks));
            if (v !== currentWeeks) update("weeks", String(v));
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="minFree" className="text-xs text-muted-foreground">Min. free hours in a week</Label>
        <Input
          id="minFree"
          type="number"
          min={0}
          step={1}
          defaultValue={currentMinFree || ""}
          placeholder="any"
          className="w-32"
          onBlur={(e) => {
            const v = Math.max(0, Number(e.target.value) || 0);
            if (v !== currentMinFree) update("minFree", v > 0 ? String(v) : "");
          }}
        />
      </div>
    </div>
  );
}
