"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckIcon, PencilIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { HourProgress } from "@/components/hour-progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { quickUpdateTaskAction } from "../../../milestone-actions";

const STATUSES = ["TODO", "IN_PROGRESS", "DONE"] as const;
type Status = (typeof STATUSES)[number];
type Option = { id: string; name: string };

export function TaskRow({
  task,
  members,
  usedHours,
  editHref,
}: {
  task: {
    id: string;
    name: string;
    assigneeId: string | null;
    assigneeName: string | null;
    estimatedHours: string | null;
    dueDate: string | null;
    status: Status;
  };
  members: Option[];
  usedHours: number;
  editHref: string;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(task.name);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "__none__");
  const [status, setStatus] = useState<Status>(task.status);
  const [hours, setHours] = useState(task.estimatedHours ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");

  function cancel() {
    setName(task.name);
    setAssigneeId(task.assigneeId ?? "__none__");
    setStatus(task.status);
    setHours(task.estimatedHours ?? "");
    setDueDate(task.dueDate ?? "");
    setEditing(false);
  }

  function save() {
    if (!name.trim()) {
      toast.error("Task name is required.");
      return;
    }
    startTransition(async () => {
      try {
        await quickUpdateTaskAction(task.id, {
          name: name.trim(),
          assigneeId: assigneeId === "__none__" ? null : assigneeId,
          estimatedHours: hours ? Number(hours) : null,
          dueDate: dueDate || null,
          status,
        });
        setEditing(false);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to save task.");
      }
    });
  }

  if (!editing) {
    return (
      <TableRow>
        <TableCell>{task.name}</TableCell>
        <TableCell>{task.assigneeName ?? "—"}</TableCell>
        <TableCell>
          <Badge variant="secondary">{task.status.replaceAll("_", " ")}</Badge>
        </TableCell>
        <TableCell>
          <HourProgress used={usedHours} cap={task.estimatedHours ? Number(task.estimatedHours) : null} />
        </TableCell>
        <TableCell>{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "—"}</TableCell>
        <TableCell>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon-xs" onClick={() => setEditing(true)} title="Quick edit">
              <PencilIcon />
            </Button>
            <Link href={editHref} className="text-sm text-primary hover:underline">
              Edit
            </Link>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" disabled={pending} />
      </TableCell>
      <TableCell>
        <Select
          value={assigneeId}
          disabled={pending}
          items={[{ value: "__none__", label: "Unassigned" }, ...members.map((m) => ({ value: m.id, label: m.name }))]}
          onValueChange={(v) => v && setAssigneeId(v)}
        >
          <SelectTrigger size="sm" className="w-full">
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
      </TableCell>
      <TableCell>
        <Select
          value={status}
          disabled={pending}
          items={STATUSES.map((s) => ({ value: s, label: s.replaceAll("_", " ") }))}
          onValueChange={(v) => v && setStatus(v as Status)}
        >
          <SelectTrigger size="sm" className="w-full">
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
      </TableCell>
      <TableCell>
        <Input
          type="number"
          step="0.5"
          min="0"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className="h-8 w-24"
          placeholder="no cap"
          disabled={pending}
        />
      </TableCell>
      <TableCell>
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="h-8"
          disabled={pending}
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-xs" onClick={save} disabled={pending} title="Save">
            <CheckIcon />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={cancel} disabled={pending} title="Cancel">
            <XIcon />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
