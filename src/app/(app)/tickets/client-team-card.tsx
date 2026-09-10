"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CrownIcon, UserPlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InitialsAvatar } from "@/components/initials-avatar";
import { cn } from "@/lib/utils";
import { addClientTeamMemberAction, removeClientTeamMemberAction, setClientTeamRoleAction } from "@/app/(app)/tickets/team-actions";

export type TeamMember = { id: string; userId: string; name: string; role: "LEAD" | "MEMBER" };
export type TeamCandidate = { id: string; name: string };

const NONE = "__none__";

/** The people staffed on one client's support (the AMS team). Renders inside whatever card the
 *  caller provides — the client workspace and the admin client page both use it. */
export function ClientTeamCard({ clientId, members, candidates, canEdit }: {
  clientId: string;
  members: TeamMember[];
  /** Active staff not yet on the team. Only needed when `canEdit`. */
  candidates: TeamCandidate[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [userId, setUserId] = useState(NONE);
  const [role, setRole] = useState<"LEAD" | "MEMBER">("MEMBER");

  function run(fn: () => Promise<{ error?: string }>, ok: string) {
    start(async () => {
      const r = await fn();
      if (r.error) toast.error(r.error);
      else { toast.success(ok); router.refresh(); }
    });
  }

  const leads = members.filter((m) => m.role === "LEAD");
  const rest = members.filter((m) => m.role !== "LEAD");
  const ordered = [...leads, ...rest];

  return (
    <div className="flex flex-col gap-3">
      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody is staffed on this account yet — only admins can see its tickets until someone is added.
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {ordered.map((m) => (
            <li key={m.id} className="flex items-center gap-2.5 py-2">
              <InitialsAvatar name={m.name} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.name}</span>
              {m.role === "LEAD" ? (
                <Badge className="gap-1 bg-primary/15 text-primary hover:bg-primary/15"><CrownIcon className="size-3" /> Lead</Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">Member</Badge>
              )}
              {canEdit && (
                <div className="flex items-center gap-0.5">
                  <Button
                    size="sm" variant="ghost" disabled={pending}
                    title={m.role === "LEAD" ? "Make member" : "Make lead"}
                    onClick={() => run(() => setClientTeamRoleAction(m.id, m.role === "LEAD" ? "MEMBER" : "LEAD"), m.role === "LEAD" ? "Now a member." : "Now the lead.")}
                  >
                    <CrownIcon className={cn("size-3.5", m.role === "LEAD" ? "text-primary" : "text-muted-foreground")} />
                  </Button>
                  <Button
                    size="sm" variant="ghost" disabled={pending} title="Remove from this account"
                    onClick={() => run(() => removeClientTeamMemberAction(m.id), `${m.name} removed.`)}
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <div className="flex gap-2">
            <Select
              value={userId}
              items={[{ value: NONE, label: candidates.length ? "Add a person…" : "Everyone is on the team" }, ...candidates.map((c) => ({ value: c.id, label: c.name }))]}
              onValueChange={(v) => setUserId(v ?? NONE)}
              disabled={candidates.length === 0}
            >
              <SelectTrigger className="h-9 flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{candidates.length ? "Add a person…" : "Everyone is on the team"}</SelectItem>
                {candidates.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={role} items={[{ value: "MEMBER", label: "Member" }, { value: "LEAD", label: "Lead" }]} onValueChange={(v) => setRole((v as "LEAD" | "MEMBER") ?? "MEMBER")}>
              <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MEMBER">Member</SelectItem>
                <SelectItem value="LEAD">Lead</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm" variant="outline" className="w-fit" disabled={pending || userId === NONE}
            onClick={() => run(async () => {
              const r = await addClientTeamMemberAction({ clientId, userId, role });
              if (!r.error) setUserId(NONE);
              return r;
            }, "Added to the team.")}
          >
            <UserPlusIcon className="size-3.5" /> Add to team
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Being on the team is what lets someone see and work this client&apos;s tickets. Leads are the escalation point and are listed first.
          </p>
        </div>
      )}
    </div>
  );
}
