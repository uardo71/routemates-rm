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
  title: string | null;
  phone: string | null;
  location: string | null;
  canDelete: boolean;
  employment: {
    costRate: string;
    costRateIsComputed: boolean;
    weeklyCapacityHours: string;
    startDate: string | null;
    endDate: string | null;
    carriedInVacationDays: string | null;
    carriedInVacationYear: number | null;
  } | null;
};

function Section({
  title,
  description,
  first,
  children,
}: {
  title: string;
  description?: string;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={first ? "flex flex-col gap-3" : "flex flex-col gap-3 border-t pt-6"}>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function EditUserForm({ user }: { user: EditableUser }) {
  const [error, formAction, pending] = useActionState(updateUserAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="userId" value={user.id} />

      <Section title="Profile">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" defaultValue={user.name} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={user.email} required />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Job title</Label>
            <Input id="title" name="title" defaultValue={user.title ?? ""} placeholder="e.g. Senior Consultant" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" type="tel" defaultValue={user.phone ?? ""} placeholder="Optional" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="location">Location</Label>
            <Input id="location" name="location" defaultValue={user.location ?? ""} placeholder="Optional" />
          </div>
        </div>
      </Section>

      <Section title="Access">
        <div className="grid gap-3 sm:grid-cols-2">
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
      </Section>

      <Section
        title="Employment"
        description="Track a cost rate (derived from salary history) and employment window for this person."
      >
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
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="startDate">Employment start date</Label>
            <Input id="startDate" name="startDate" type="date" defaultValue={user.employment?.startDate ?? undefined} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="endDate">Employment end date</Label>
            <Input id="endDate" name="endDate" type="date" defaultValue={user.employment?.endDate ?? undefined} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="weeklyCapacityHours">Weekly capacity (hours)</Label>
            <Input
              id="weeklyCapacityHours"
              name="weeklyCapacityHours"
              type="number"
              step="0.5"
              min="0"
              max="80"
              defaultValue={user.employment?.weeklyCapacityHours ?? "40"}
              placeholder="40"
            />
            <p className="text-xs text-muted-foreground">
              Contracted hours in a full week — 20 for a half-timer. The planner sizes a day at a fifth of
              this, so holidays and leave are deducted against the real contract.
            </p>
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
      </Section>

      <Section title="Vacation carry-in">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="carriedInVacationDays">Vacation carried in (days)</Label>
            <Input
              id="carriedInVacationDays"
              name="carriedInVacationDays"
              type="number"
              step="0.5"
              min="0"
              defaultValue={user.employment?.carriedInVacationDays ?? undefined}
              placeholder="e.g. 12.5"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="carriedInVacationYear">As of Jan 1 of</Label>
            <Input
              id="carriedInVacationYear"
              name="carriedInVacationYear"
              type="number"
              min="2000"
              max="2100"
              defaultValue={user.employment?.carriedInVacationYear ?? undefined}
              placeholder={`${new Date().getFullYear()}`}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Opening vacation balance for someone onboarded onto the app after they were hired — the days left at
          the start of that year. The system then adds each year&apos;s entitlement and subtracts logged vacation
          automatically, so you never back-enter old requests. Leave days blank to instead compute the balance
          purely from time off recorded in the app.
        </p>
      </Section>

      <Section title="Security">
        <div className="flex flex-col gap-1.5 max-w-xs">
          <Label htmlFor="newPassword">Reset password (optional)</Label>
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            minLength={8}
            placeholder="Leave blank to keep current password"
          />
        </div>
      </Section>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2 border-t pt-6">
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
        <p className="text-xs text-muted-foreground -mt-3">
          This user has time entries, assignments, approvals, or manages a project — deactivate instead of deleting.
        </p>
      )}
    </form>
  );
}
