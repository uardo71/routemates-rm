"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { reallocateHoursAction } from "../milestone-actions";

type Option = { id: string; name: string };

export function ReallocateHoursForm({ milestones }: { milestones: Option[] }) {
  const [error, formAction, pending] = useActionState(reallocateHoursAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fromMilestoneId">From milestone</Label>
          <Select name="fromMilestoneId" required items={milestones.map((m) => ({ value: m.id, label: m.name }))}>
            <SelectTrigger id="fromMilestoneId" className="w-full">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              {milestones.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="toMilestoneId">To milestone</Label>
          <Select name="toMilestoneId" required items={milestones.map((m) => ({ value: m.id, label: m.name }))}>
            <SelectTrigger id="toMilestoneId" className="w-full">
              <SelectValue placeholder="Destination" />
            </SelectTrigger>
            <SelectContent>
              {milestones.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hours">Hours to move</Label>
          <Input id="hours" name="hours" type="number" step="0.5" min="0" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reason">Reason (optional)</Label>
          <Input id="reason" name="reason" placeholder="e.g. Phase 1 came in under budget" />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Reallocating..." : "Reallocate hours"}
      </Button>
    </form>
  );
}
