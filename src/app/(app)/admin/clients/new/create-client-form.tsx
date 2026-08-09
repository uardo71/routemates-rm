"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClientAction } from "../actions";

export function CreateClientForm() {
  const [error, formAction, pending] = useActionState(createClientAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3 max-w-sm">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Client name</Label>
        <Input id="name" name="name" required autoFocus />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Creating..." : "Create client"}
      </Button>
    </form>
  );
}
