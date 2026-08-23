"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DeleteButton } from "@/components/delete-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateTaskAction, deleteTaskAction } from "../../../../../../milestone-actions";

const STATUSES = ["TODO", "IN_PROGRESS", "DONE"] as const;
type Option = { id: string; name: string };

export function EditTaskForm({
  task,
  members,
  canDelete,
}: {
  task: {
    id: string;
    name: string;
    assigneeId: string | null;
    estimatedHours: string | null;
    dueDate: string | null;
    status: (typeof STATUSES)[number];
  };
  members: Option[];
  canDelete: boolean;
}) {
  const [error, formAction, pending] = useActionState(updateTaskAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="taskId" value={task.id} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Task name</Label>
          <Input id="name" name="name" defaultValue={task.name} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assigneeId">Assignee</Label>
          <Select
            name="assigneeId"
            defaultValue={task.assigneeId ?? "__none__"}
            items={[{ value: "__none__", label: "Unassigned" }, ...members.map((m) => ({ value: m.id, label: m.name }))]}
          >
            <SelectTrigger id="assigneeId" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Unassigned</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="estimatedHours">Allocated hours</Label>
          <Input id="estimatedHours" name="estimatedHours" type="number" step="any" min="0" defaultValue={task.estimatedHours ?? undefined} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dueDate">Due date</Label>
          <Input id="dueDate" name="dueDate" type="date" defaultValue={task.dueDate ?? undefined} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5 max-w-xs">
        <Label htmlFor="status">Status</Label>
        <Select name="status" defaultValue={task.status} items={STATUSES.map((s) => ({ value: s, label: s.replaceAll("_", " ") }))}>
          <SelectTrigger id="status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replaceAll("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? "Saving..." : "Save changes"}
        </Button>
        {canDelete && (
          <DeleteButton action={() => deleteTaskAction(task.id)} confirmMessage={`Delete task "${task.name}"?`} />
        )}
      </div>
      {!canDelete && <p className="text-xs text-muted-foreground">This task has time entries — can&apos;t be deleted.</p>}
    </form>
  );
}
