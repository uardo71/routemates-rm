import { requirePermission } from "@/lib/session";
import { loadTicketConfig } from "@/lib/ticket-config.server";
import { getCompanySlaDefault } from "@/lib/sla.server";
import { TicketSettingsClient, type SettingsConfig } from "./settings-client";
import { SupportShell } from "../support-shell";

export const metadata = { title: "Ticket settings" };

export default async function TicketSettingsPage() {
  const user = await requirePermission("tickets:manage");
  const cfg = await loadTicketConfig(user.companyId, true);
  const slaDefault = await getCompanySlaDefault(user.companyId);

  const archived = (typeId: string | null) => cfg.archivedFields
    .filter((f) => f.typeId === typeId)
    .map((f) => ({ id: f.id, name: f.name, kind: f.kind, archivedAt: f.archivedAt ?? "" }));
  const config: SettingsConfig = {
    archivedGlobalFields: archived(null),
    types: cfg.types.map((t) => ({
      archivedFields: archived(t.id),
      id: t.id, key: t.key, name: t.name, description: t.description, icon: t.icon, color: t.color,
      active: t.active, isDefault: t.isDefault, customerCanCreate: t.customerCanCreate, slaExempt: t.slaExempt,
      statuses: t.statuses.map((s) => ({ id: s.id, name: s.name, color: s.color, category: s.category, isInitial: s.isInitial, customerVisible: s.customerVisible, customerCanSet: s.customerCanSet })),
      // A STAGE-mode type's lifecycle. Read-only here for now — the stage/gate editors come later;
      // without this the Workflow column would simply look empty for such a type.
      lifecycleMode: t.lifecycleMode,
      stages: t.stages.map((st) => ({ id: st.id, name: st.name, isStarting: st.isStarting, isTerminal: st.isTerminal, gates: st.gates.map((g) => g.label) })),
      archivedStatuses: t.archivedStatuses.map((s) => ({ id: s.id, name: s.name, archivedAt: s.archivedAt ?? "" })),
      fields: t.fields.map((f) => ({ id: f.id, name: f.name, kind: f.kind, options: f.options, required: f.required, customerVisible: f.customerVisible, customerEditable: f.customerEditable })),
    })),
    globalFields: cfg.globalFields.map((f) => ({ id: f.id, name: f.name, kind: f.kind, options: f.options, required: f.required, customerVisible: f.customerVisible, customerEditable: f.customerEditable })),
  };

  return (
    <SupportShell
      active="settings"
      back={{ href: "/tickets", label: "Support" }}
      title="Ticket configuration"
      subtitle="Types, per-type workflows, custom fields and what customers can see or do."
      canManage
    >
      <TicketSettingsClient config={config} slaDefault={slaDefault} />
    </SupportShell>
  );
}
