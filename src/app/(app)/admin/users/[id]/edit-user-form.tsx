"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DeleteButton } from "@/components/delete-button";
import { formatMoney } from "@/lib/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateUserAction, deleteUserAction } from "../actions";

const ROLES = ["ADMIN", "FINANCE", "SALES", "PM", "EMPLOYEE", "CONTRACTOR"] as const;

type EditableUser = {
  id: string;
  name: string;
  email: string;
  role: (typeof ROLES)[number];
  active: boolean;
  canDelete: boolean;
  employment: {
    costRate: string;
    costRateIsComputed: boolean;
    startDate: string | null;
    endDate: string | null;
  } | null;
};

export function EditUserForm({ user }: { user: EditableUser }) {
  const [error, formAction, pending] = useActionState(updateUserAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="userId" value={user.id} />
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" defaultValue={user.name} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={user.email} required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role">System role</Label>
          <Select name="role" defaultValue={user.role} items={ROLES.map((r) => ({ value: r, label: r }))}>
            <SelectTrigger id="role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 pt-6">
          <input id="active" name="active" type="checkbox" defaultChecked={user.active} className="size-4" />
          <Label htmlFor="active">Active</Label>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="trackEmployment"
          name="trackEmployment"
          type="checkbox"
          defaultChecked={user.employment !== null}
          className="size-4"
        />
        <Label htmlFor="trackEmployment">Track employment / cost rate for this person</Label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="startDate">Employment start date</Label>
          <Input id="startDate" name="startDate" type="date" defaultValue={user.employment?.startDate ?? undefined} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="endDate">Employment end date</Label>
          <Input id="endDate" name="endDate" type="date" defaultValue={user.employment?.endDate ?? undefined} />
        </div>
      </div>
      {user.employment && (
        <div className="flex flex-col gap-1.5 max-w-xs">
          <Label>Cost rate (computed)</Label>
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            {formatMoney(user.employment.costRate, "EUR")}/hr
            {!user.employment.costRateIsComputed && (
              <span className="ml-1.5 text-xs text-muted-foreground">(no salary on file yet)</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Derived from salary history below, not entered directly — add a salary to compute a real rate.
          </p>
        </div>
      )}
      <div className="flex flex-col gap-1.5 max-w-xs">
        <Label htmlFor="newPassword">Reset password (optional)</Label>
        <Input id="newPassword" name="newPassword" type="password" minLength={8} placeholder="Leave blank to keep current password" />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? "Saving..." : "Save changes"}
        </Button>
        <DeleteButton
          action={() => deleteUserAction(user.id)}
          confirmMessage={`Delete ${user.name}? This cannot be undone.`}
          className={user.canDelete ? undefined : "hidden"}
        />
      </div>
      {!user.canDelete && (
        <p className="text-xs text-muted-foreground">
          This user has time entries, assignments, approvals, or manages a project — deactivate instead of deleting.
        </p>
      )}
    </form>
  );
}
