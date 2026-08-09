"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addContactAction } from "../actions";

export function AddContactForm({ clientId }: { clientId: string }) {
  const [error, formAction, pending] = useActionState(addContactAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contactName">Name</Label>
          <Input id="contactName" name="name" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contactEmail">Email</Label>
          <Input id="contactEmail" name="email" type="email" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contactPhone">Phone</Label>
          <Input id="contactPhone" name="phone" />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Adding..." : "Add contact"}
      </Button>
    </form>
  );
}
