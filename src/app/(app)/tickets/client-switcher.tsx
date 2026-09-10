"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Jump straight between client workspaces — the DevOps project-switcher idea — so nobody has to go
 *  back to the overview and re-filter as the client list grows. */
export function ClientSwitcher({ current, clients }: { current: string; clients: { id: string; name: string }[] }) {
  const router = useRouter();
  return (
    <Select value={current} items={clients.map((c) => ({ value: c.id, label: c.name }))} onValueChange={(v) => v && v !== current && router.push(`/tickets/c/${v}`)}>
      <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
      <SelectContent>
        {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
