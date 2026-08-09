"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DeleteButton } from "@/components/delete-button";
import { updateClientAction, deleteClientAction } from "../actions";

export function EditClientForm({ clientId, name }: { clientId: string; name: string }) {
  const [error, formAction, pending] = useActionState(updateClientAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3 max-w-sm">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Client name</Label>
        <Input id="name" name="name" defaultValue={name} required />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? "Saving..." : "Save changes"}
        </Button>
        <DeleteButton
          action={() => deleteClientAction(clientId)}
          confirmMessage={`Delete ${name}? This cannot be undone.`}
        />
      </div>
    </form>
  );
}
