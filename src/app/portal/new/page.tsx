import Link from "next/link";
import { requirePortalUser } from "@/lib/portal";
import { loadTicketConfig, customerConfig } from "@/lib/ticket-config.server";
import { PortalNewForm, type PortalFormConfig } from "./portal-new-form";

export const metadata = { title: "New ticket" };

export default async function PortalNewPage() {
  const u = await requirePortalUser();
  const cfg = customerConfig(await loadTicketConfig(u.companyId));

  // Portal forms never expose USER-kind fields (they'd leak the internal staff directory).
  const pub = (fs: { id: string; key: string; name: string; kind: string; options: string[]; required: boolean }[]) =>
    fs.filter((f) => f.kind !== "USER").map((f) => ({ id: f.id, key: f.key, name: f.name, kind: f.kind, options: f.options, required: f.required }));

  const config: PortalFormConfig = {
    types: cfg.types.map((t) => ({ id: t.id, name: t.name, color: t.color, icon: t.icon, fields: pub(t.fields) })),
    globalFields: pub(cfg.globalFields),
  };

  return (
    <div className="flex flex-col gap-5">
      <Link href="/portal" className="text-sm text-muted-foreground hover:underline">← My tickets</Link>
      <h1 className="text-2xl font-semibold tracking-tight">Raise a ticket</h1>
      {config.types.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No ticket types are available right now. Please contact your account manager.</p>
      ) : (
        <PortalNewForm config={config} />
      )}
    </div>
  );
}
