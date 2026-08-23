"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { copyTasksAction } from "../../../../../milestone-actions";

type SourceTask = { id: string; name: string; estimatedHours: string };

export function CopyTasksForm({
  targetMilestoneId,
  tasks,
}: {
  targetMilestoneId: string;
  tasks: SourceTask[];
}) {
  const [error, formAction, pending] = useActionState(copyTasksAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="targetMilestoneId" value={targetMilestoneId} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>Task name</TableHead>
            <TableHead className="w-40">Estimated hours</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((t, i) => (
            <TableRow key={t.id}>
              <TableCell>
                <input type="hidden" name={`task_${i}_id`} value={t.id} />
                <input type="checkbox" name={`task_${i}_selected`} defaultChecked className="size-4" />
              </TableCell>
              <TableCell>
                <Input name={`task_${i}_name`} defaultValue={t.name} required />
              </TableCell>
              <TableCell>
                <Input name={`task_${i}_hours`} type="number" step="any" min="0" defaultValue={t.estimatedHours} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Copying..." : "Copy selected tasks"}
      </Button>
    </form>
  );
}
