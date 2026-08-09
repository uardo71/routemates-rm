"use client";

import { useRouter } from "next/navigation";
import { CalendarIcon } from "lucide-react";

export function WeekJump({
  currentDate,
  basePath,
  dateParam,
  extraParams,
}: {
  /** Any date (yyyy-MM-dd) within the currently viewed week — the server snaps it to that week's start. */
  currentDate: string;
  basePath: string;
  dateParam: string;
  extraParams?: Record<string, string | undefined>;
}) {
  const router = useRouter();

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    if (!value) return;
    const params = new URLSearchParams();
    params.set(dateParam, value);
    if (extraParams) {
      for (const [key, val] of Object.entries(extraParams)) {
        if (val) params.set(key, val);
      }
    }
    router.push(`${basePath}?${params.toString()}`);
  }

  return (
    <label className="relative inline-flex items-center" title="Jump to a specific week">
      <CalendarIcon className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
      <input
        type="date"
        defaultValue={currentDate}
        onChange={handleChange}
        aria-label="Jump to date"
        className="h-8 rounded-md border border-input bg-background pl-7 pr-2 text-sm text-foreground"
      />
    </label>
  );
}
