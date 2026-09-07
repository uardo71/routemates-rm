import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { loadTicketConfig } from "@/lib/ticket-config.server";
import { getCompanySlaDefault } from "@/lib/sla.server";
import { TicketSettingsClient, type SettingsConfig } from "./settings-client";

export const metadata = { title: "Ticket settings" };

export default async function TicketSettingsPage() {
  const user = await requirePermission("tickets:manage");
  const cfg = await loadTicketConfig(user.companyId, true);
  const slaDefault = await getCompanySlaDefault(user.companyId);

  const config: SettingsConfig = {
    types: cfg.types.map((t) => ({
      id: t.id, key: t.key, name: t.name, description: t.description, icon: t.icon, color: t.color,
      active: t.active, isDefault: t.isDefault, customerCanCreate: t.customerCanCreate,
      statuses: t.statuses.map((s) => ({ id: s.id, name: s.name, color: s.color, category: s.category, isInitial: s.isInitial, customerVisible: s.customerVisible, customerCanSet: s.customerCanSet })),
      fields: t.fields.map((f) => ({ id: f.id, name: f.name, kind: f.kind, options: f.options, required: f.required, customerVisible: f.customerVisible, customerEditable: f.customerEditable })),
    })),
    globalFields: cfg.globalFields.map((f) => ({ id: f.id, name: f.name, kind: f.kind, options: f.options, required: f.required, customerVisible: f.customerVisible, customerEditable: f.customerEditable })),
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/tickets" className="text-sm text-muted-foreground hover:underline">← Tickets</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Ticket configuration</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Types, per-type workflows, custom fields and what customers can see or do.</p>
        </div>
      </div>
      <TicketSettingsClient config={config} slaDefault={slaDefault} />
    </div>
  );
}
