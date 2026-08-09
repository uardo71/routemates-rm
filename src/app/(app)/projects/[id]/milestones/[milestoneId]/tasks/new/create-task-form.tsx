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
import { createTaskAction } from "../../../../../milestone-actions";

type Option = { id: string; name: string };

export function CreateTaskForm({ milestoneId, members }: { milestoneId: string; members: Option[] }) {
  const [error, formAction, pending] = useActionState(createTaskAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="milestoneId" value={milestoneId} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="taskName">Task name</Label>
          <Input id="taskName" name="name" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="taskAssigneeId">Assignee</Label>
          <Select name="assigneeId" items={members.map((m) => ({ value: m.id, label: m.name }))}>
            <SelectTrigger id="taskAssigneeId" className="w-full">
              <SelectValue placeholder="Unassigned" />
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="taskEstimatedHours">Allocated hours</Label>
          <Input id="taskEstimatedHours" name="estimatedHours" type="number" step="0.5" min="0" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="taskDueDate">Due date</Label>
          <Input id="taskDueDate" name="dueDate" type="date" />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Adding..." : "Add task"}
      </Button>
    </form>
  );
}
