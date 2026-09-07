import "server-only";
import { Prisma } from "@prisma/client";
import type { TicketStatusCategory, TicketFieldKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_TICKET_CONFIG } from "@/lib/ticket-config";

export type LoadedStatus = {
  id: string; key: string; name: string; color: string | null; category: TicketStatusCategory;
  order: number; isInitial: boolean; customerVisible: boolean; customerCanSet: boolean;
};
export type LoadedField = {
  id: string; typeId: string | null; key: string; name: string; kind: TicketFieldKind;
  options: string[]; required: boolean; customerVisible: boolean; customerEditable: boolean; order: number;
};
export type LoadedType = {
  id: string; key: string; name: string; description: string | null; icon: string | null; color: string | null;
  order: number; active: boolean; isDefault: boolean; customerCanCreate: boolean;
  statuses: LoadedStatus[]; fields: LoadedField[];
};
export type TicketConfig = { types: LoadedType[]; globalFields: LoadedField[] };

function opts(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Create the default ticketing configuration for a company the first time the module is used. */
export async function ensureTicketConfig(companyId: string): Promise<void> {
  const existing = await prisma.ticketTypeDef.count({ where: { companyId } });
  if (existing > 0) return;
  try {
    await seedTicketConfig(companyId);
  } catch (e) {
    // Concurrent first-load can race two seeders; the unique (companyId,key) constraint lets exactly
    // one win. Treat the loser's P2002 as success — the config now exists either way.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return;
    throw e;
  }
}

async function seedTicketConfig(companyId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction to avoid a double seed under a race.
    if ((await tx.ticketTypeDef.count({ where: { companyId } })) > 0) return;
    for (let ti = 0; ti < DEFAULT_TICKET_CONFIG.length; ti++) {
      const t = DEFAULT_TICKET_CONFIG[ti];
      const type = await tx.ticketTypeDef.create({
        data: {
          companyId, key: t.key, name: t.name, description: t.description ?? null,
          icon: t.icon, color: t.color, order: ti, active: true,
          isDefault: t.isDefault ?? false, customerCanCreate: t.customerCanCreate ?? true,
        },
      });
      await tx.ticketStatusDef.createMany({
        data: t.statuses.map((s, si) => ({
          companyId, typeId: type.id, key: s.key, name: s.name, color: s.color, category: s.category,
          order: si, isInitial: s.isInitial ?? false,
          customerVisible: s.customerVisible ?? true, customerCanSet: s.customerCanSet ?? false,
        })),
      });
      if (t.fields?.length) {
        await tx.ticketFieldDef.createMany({
          data: t.fields.map((f, fi) => ({
            companyId, typeId: type.id, key: f.key, name: f.name, kind: f.kind,
            options: f.options ?? undefined, required: f.required ?? false,
            customerVisible: f.customerVisible ?? true, customerEditable: f.customerEditable ?? false, order: fi,
          })),
        });
      }
    }
  });
}

/** Load the full (or active-only) ticketing configuration for a company, seeding defaults if empty. */
export async function loadTicketConfig(companyId: string, includeInactive = false): Promise<TicketConfig> {
  await ensureTicketConfig(companyId);
  const [types, fields] = await Promise.all([
    prisma.ticketTypeDef.findMany({
      where: { companyId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { order: "asc" },
      include: { statuses: { orderBy: { order: "asc" } } },
    }),
    prisma.ticketFieldDef.findMany({
      where: { companyId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { order: "asc" },
    }),
  ]);
  const fieldsByType = new Map<string, LoadedField[]>();
  const globalFields: LoadedField[] = [];
  for (const f of fields) {
    const lf: LoadedField = {
      id: f.id, typeId: f.typeId, key: f.key, name: f.name, kind: f.kind, options: opts(f.options),
      required: f.required, customerVisible: f.customerVisible, customerEditable: f.customerEditable, order: f.order,
    };
    if (f.typeId) { const a = fieldsByType.get(f.typeId) ?? []; a.push(lf); fieldsByType.set(f.typeId, a); }
    else globalFields.push(lf);
  }
  const loadedTypes: LoadedType[] = types.map((t) => ({
    id: t.id, key: t.key, name: t.name, description: t.description, icon: t.icon, color: t.color,
    order: t.order, active: t.active, isDefault: t.isDefault, customerCanCreate: t.customerCanCreate,
    statuses: t.statuses.map((s) => ({
      id: s.id, key: s.key, name: s.name, color: s.color, category: s.category, order: s.order,
      isInitial: s.isInitial, customerVisible: s.customerVisible, customerCanSet: s.customerCanSet,
    })),
    fields: fieldsByType.get(t.id) ?? [],
  }));
  return { types: loadedTypes, globalFields };
}

/** All fields that apply to a given type = the type's own fields plus company-wide global fields. */
export function fieldsForType(config: TicketConfig, typeId: string): LoadedField[] {
  const t = config.types.find((x) => x.id === typeId);
  return [...(t?.fields ?? []), ...config.globalFields].sort((a, b) => a.order - b.order);
}

export function findType(config: TicketConfig, typeId: string): LoadedType | undefined {
  return config.types.find((t) => t.id === typeId);
}
export function initialStatus(type: LoadedType): LoadedStatus | undefined {
  return type.statuses.find((s) => s.isInitial) ?? type.statuses[0];
}
export function defaultType(config: TicketConfig): LoadedType | undefined {
  return config.types.find((t) => t.isDefault) ?? config.types[0];
}

/** Customer-facing projection: only customer-creatable types, customer-visible statuses & fields. */
export function customerConfig(config: TicketConfig): TicketConfig {
  return {
    types: config.types
      .filter((t) => t.customerCanCreate)
      .map((t) => ({
        ...t,
        statuses: t.statuses.filter((s) => s.customerVisible),
        fields: t.fields.filter((f) => f.customerVisible),
      })),
    globalFields: config.globalFields.filter((f) => f.customerVisible),
  };
}
