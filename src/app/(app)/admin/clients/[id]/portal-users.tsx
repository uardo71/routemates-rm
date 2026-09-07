"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { KeyRoundIcon, UserPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPortalUserAction, setPortalUserActiveAction, resetPortalUserPasswordAction } from "../actions";

type PortalUser = { id: string; name: string; email: string; active: boolean };

export function PortalUsers({ clientId, users }: { clientId: string; users: PortalUser[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createPortalUserAction, undefined as string | undefined);
  const [busy, start] = React.useTransition();
  const [resetId, setResetId] = React.useState<string | null>(null);
  const [pw, setPw] = React.useState("");
  const [msg, setMsg] = React.useState<string | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => { if (state === undefined && formRef.current) formRef.current.reset(); }, [state]);

  const act = (fn: () => Promise<{ error?: string }>) => start(async () => { const r = await fn(); if (r?.error) setMsg(r.error); else { setMsg(null); router.refresh(); } });

  return (
    <div className="flex flex-col gap-4">
      {users.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          {users.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-3 border-b px-3 py-2.5 last:border-none">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{u.name}</div>
                <div className="truncate text-xs text-muted-foreground">{u.email}</div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs ${u.active ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>{u.active ? "Active" : "Disabled"}</span>
              {resetId === u.id ? (
                <div className="flex items-center gap-1.5">
                  <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password" className="h-8 w-40" />
                  <Button size="sm" disabled={busy || pw.length < 8} onClick={() => act(async () => { const r = await resetPortalUserPasswordAction(u.id, pw); if (!r.error) { setResetId(null); setPw(""); } return r; })}>Set</Button>
                  <Button size="sm" variant="outline" onClick={() => { setResetId(null); setPw(""); }}>Cancel</Button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => setResetId(u.id)} className="gap-1"><KeyRoundIcon className="size-3.5" /> Password</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => setPortalUserActiveAction(u.id, !u.active))}>{u.active ? "Disable" : "Enable"}</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No portal accounts yet. Create one so this client can log tickets themselves.</p>
      )}
      {msg && <p className="text-sm text-destructive">{msg}</p>}

      <form ref={formRef} action={formAction} className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
        <div className="text-sm font-medium">Add a portal account</div>
        <input type="hidden" name="clientId" value={clientId} />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1"><Label htmlFor="pu-name">Name</Label><Input id="pu-name" name="name" required placeholder="Full name" /></div>
          <div className="flex flex-col gap-1"><Label htmlFor="pu-email">Email</Label><Input id="pu-email" name="email" type="email" required placeholder="person@customer.com" /></div>
          <div className="flex flex-col gap-1"><Label htmlFor="pu-pw">Temporary password</Label><Input id="pu-pw" name="password" type="text" required minLength={8} placeholder="At least 8 characters" /></div>
        </div>
        <p className="text-xs text-muted-foreground">Share these credentials with the customer securely. They sign in at <span className="font-mono">/portal</span> and can change nothing but their own tickets.</p>
        {state && <p className="text-sm text-destructive">{state}</p>}
        <div className="flex justify-end"><Button type="submit" disabled={pending} className="gap-1.5"><UserPlusIcon className="size-4" /> {pending ? "Creating…" : "Create account"}</Button></div>
      </form>
    </div>
  );
}
