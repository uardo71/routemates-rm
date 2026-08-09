"use client";

import { addDays, format } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Small "Now" pill marking a grid's current-week column — used alongside the thicker column
 *  border on Planner and Scheduled vs actuals so "today" is unmistakable even before you've
 *  matched the date up mentally. Hover/focus shows the week's actual date range. */
export function CurrentWeekBadge({ weekStartDate }: { weekStartDate: string }) {
  const start = new Date(weekStartDate);
  const end = addDays(start, 6);
  const label = `Current week — ${format(start, "MMM d")}–${format(end, "MMM d, yyyy")}`;

  return (
    <Tooltip>
      <TooltipTrigger className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground shadow-sm">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-foreground/70" />
          <span className="relative inline-flex size-1.5 rounded-full bg-primary-foreground" />
        </span>
        Now
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
