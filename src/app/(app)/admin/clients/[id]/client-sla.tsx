"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { SlaTargets } from "@/lib/sla";
import { SlaEditor } from "../../../tickets/sla-editor";
import { saveClientSlaAction } from "../../../tickets/sla-actions";

export function ClientSla({ clientId, defaultTargets, override }: { clientId: string; defaultTargets: SlaTargets; override: SlaTargets | null }) {
  const router = useRouter();
  const [custom, setCustom] = React.useState(override !== null);
  const [busy, setBusy] = React.useState(false);

  async function toggle(next: boolean) {
    setCustom(next);
    if (!next) {
      // Clearing the override → fall back to the company default.
      setBusy(true);
      await saveClientSlaAction(clientId, null);
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={custom} disabled={busy} onChange={(e) => toggle(e.target.checked)} className="accent-primary" />
        Use a custom SLA for this client
      </label>
      {custom ? (
        <SlaEditor
          initial={override ?? defaultTargets}
          onSave={(t) => saveClientSlaAction(clientId, t)}
          saveLabel="Save client SLA"
        />
      ) : (
        <p className="text-sm text-muted-foreground">This client uses the company default SLA. Tick the box to set custom response &amp; resolution times.</p>
      )}
    </div>
  );
}
