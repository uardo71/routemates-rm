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
import { createUserAction } from "../actions";

const ROLES = ["ADMIN", "FINANCE", "SALES", "PM", "EMPLOYEE", "CONTRACTOR"] as const;

export function CreateUserForm() {
  const [error, formAction, pending] = useActionState(createUserAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Temporary password</Label>
          <Input id="password" name="password" type="password" required minLength={8} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role">System role</Label>
          <Select name="role" defaultValue="EMPLOYEE" items={ROLES.map((r) => ({ value: r, label: r }))}>
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
      </div>
      <div className="flex items-center gap-2">
        <input id="trackEmployment" name="trackEmployment" type="checkbox" className="size-4" />
        <Label htmlFor="trackEmployment">Track employment / cost rate for this person</Label>
      </div>
      <div className="flex flex-col gap-1.5 max-w-xs">
        <Label htmlFor="startDate">Employment start date</Label>
        <Input id="startDate" name="startDate" type="date" />
      </div>
      <p className="text-xs text-muted-foreground">
        Cost rate isn&apos;t entered here — it&apos;s derived from salary history, which you can add on
        this person&apos;s profile after creating them.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Creating..." : "Create user"}
      </Button>
    </form>
  );
}
