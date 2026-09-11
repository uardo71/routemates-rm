"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { canManageProject } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { checkTransition, gateDecision, PROJECT_STATUS_LABEL, type ProjectStatusKey } from "@/lib/project-stage";
import { loadLifecycleContext } from "@/lib/project-lifecycle-data";

const STATUS = z.enum(["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]);
const ChangeSchema = z.object({
  projectId: z.string().min(1),
  to: STATUS,
  overrideReason: z.string().trim().max(1000).optional().nullable(),
  /** Closure only: mark UAT not applicable as part of closing. */
  uatNotApplicable: z.boolean().optional(),
  /** Closure only: close even though approved time is still unbilled. */
  wipAcknowledged: z.boolean().optional(),
});

function revalidateProject(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  revalidatePath(`/delivery/${projectId}`);
  revalidatePath("/delivery");
  revalidatePath("/portfolio");
  revalidatePath("/time");
  revalidatePath("/planning");
}

/** The ONE way a project's status changes. Checks the move is legal (project-stage.ts), runs the
 *  readiness gate on PLANNED -> ACTIVE and the closure gate on -> COMPLETED (an admin may override
 *  either with a reason), and records everything in the audit log inside the same transaction.
 *  Closing also closes every milestone for time and every active assignment, one audit row each. */
export async function changeProjectStatusAction(input: z.infer<typeof ChangeSchema>): Promise<{ error?: string }> {
  const user = await requirePermission("projects:view");
  const parsed = ChangeSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid request." };
  const d = parsed.data;
  if (!(await canManageProject(user, d.projectId))) return { error: "You do not have permission to manage this project." };
  const before = await prisma.project.findFirst({ where: { id: d.projectId, companyId: user.companyId } });
  if (!before) return { error: "Project not found." };

  const isAdmin = user.role === "ADMIN";
  const t = checkTransition(before.status, d.to, { isAdmin });
  if (!t.ok) return { error: t.reason };

  let overridden = false;
  const notes: string[] = [`${PROJECT_STATUS_LABEL[before.status as ProjectStatusKey]} → ${PROJECT_STATUS_LABEL[d.to]}`];
  let uatNotApplicable = false;
  if (t.rule.gate) {
    const ctx = await loadLifecycleContext(user, d.projectId, { wipAcknowledged: d.wipAcknowledged, uatNotApplicable: d.uatNotApplicable });
    if (!ctx) return { error: "Project not found." };
    const checks = t.rule.gate === "readiness" ? ctx.readiness : ctx.closure;
    const verdict = gateDecision(checks, { isAdmin, overrideReason: d.overrideReason });
    if (!verdict.ok) return { error: verdict.error };
    overridden = verdict.overridden;
    if (overridden) notes.push(`override: ${d.overrideReason!.trim()}`);
    if (t.rule.gate === "closure") {
      uatNotApplicable = !!d.uatNotApplicable && !before.uatNotApplicable;
      if (uatNotApplicable) notes.push("UAT marked not applicable");
      if (d.wipAcknowledged && ctx.unbilledHours > 0.005) notes.push(`unbilled work acknowledged (${ctx.currency} ${ctx.unbilledValue.toFixed(2)}, ${ctx.unbilledHours}h)`);
    }
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const after = await tx.project.update({
      where: { id: d.projectId },
      data: {
        status: d.to,
        ...(overridden && t.rule.gate === "readiness" ? { activationOverrideReason: d.overrideReason!.trim(), activationOverrideAt: now, activationOverrideById: user.id } : {}),
        ...(overridden && t.rule.gate === "closure" ? { closureOverrideReason: d.overrideReason!.trim(), closureOverrideAt: now, closureOverrideById: user.id } : {}),
        ...(uatNotApplicable ? { uatNotApplicable: true } : {}),
      },
    });
    await recordAudit(tx, {
      entityType: "Project", entityId: d.projectId, action: "update", actor: user, before, after,
      fields: ["status", "activationOverrideReason", "closureOverrideReason", "uatNotApplicable"],
      label: before.number ?? before.name, note: notes.join(" · "),
    });

    if (d.to === "COMPLETED") {
      const parent = { entityType: "Project" as const, entityId: d.projectId };
      const openMs = await tx.milestone.findMany({ where: { projectId: d.projectId, timeEntryOpen: true }, select: { id: true, name: true } });
      for (const m of openMs) {
        await tx.milestone.update({ where: { id: m.id }, data: { timeEntryOpen: false } });
        await recordAudit(tx, { entityType: "Milestone", entityId: m.id, action: "update", actor: user, before: { timeEntryOpen: true }, after: { timeEntryOpen: false }, label: m.name, parent, note: "closed for time with the project" });
      }
      const active = await tx.assignment.findMany({ where: { status: "ACTIVE", milestone: { projectId: d.projectId } }, select: { id: true, user: { select: { name: true } }, milestone: { select: { name: true } } } });
      for (const a of active) {
        await tx.assignment.update({ where: { id: a.id }, data: { status: "CLOSED" } });
        await recordAudit(tx, { entityType: "Assignment", entityId: a.id, action: "update", actor: user, before: { status: "ACTIVE" }, after: { status: "CLOSED" }, label: `${a.user.name} · ${a.milestone.name}`, parent, note: "closed with the project" });
      }
    }
  });

  revalidateProject(d.projectId);
  return {};
}

const WriteOffSchema = z.object({ milestoneId: z.string().min(1), reason: z.string().trim().min(3, "Say why this milestone is written off.").max(1000) });

/** Writes a milestone off: no more delivery or billing is expected, so it no longer blocks closure.
 *  It also closes the milestone for time. Audited. */
export async function writeOffMilestoneAction(input: z.infer<typeof WriteOffSchema>): Promise<{ error?: string }> {
  const user = await requirePermission("projects:view");
  const parsed = WriteOffSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const m = await prisma.milestone.findFirst({ where: { id: parsed.data.milestoneId, project: { companyId: user.companyId } } });
  if (!m) return { error: "Milestone not found." };
  if (!(await canManageProject(user, m.projectId))) return { error: "You do not have permission to manage this project." };
  if (m.writtenOffAt) return {};
  await prisma.$transaction(async (tx) => {
    const after = await tx.milestone.update({ where: { id: m.id }, data: { writtenOffAt: new Date(), writtenOffById: user.id, writtenOffReason: parsed.data.reason, timeEntryOpen: false } });
    await recordAudit(tx, { entityType: "Milestone", entityId: m.id, action: "update", actor: user, before: m, after, fields: ["writtenOffAt", "writtenOffReason", "timeEntryOpen"], label: m.name, parent: { entityType: "Project", entityId: m.projectId }, note: `written off: ${parsed.data.reason}` });
  });
  revalidateProject(m.projectId);
  return {};
}

/** Undoes a write-off (the milestone blocks closure again). Time entry stays closed — reopen it on the milestone if needed. */
export async function undoMilestoneWriteOffAction(milestoneId: string): Promise<{ error?: string }> {
  const user = await requirePermission("projects:view");
  const m = await prisma.milestone.findFirst({ where: { id: milestoneId, project: { companyId: user.companyId } } });
  if (!m) return { error: "Milestone not found." };
  if (!(await canManageProject(user, m.projectId))) return { error: "You do not have permission to manage this project." };
  if (!m.writtenOffAt) return {};
  await prisma.$transaction(async (tx) => {
    const after = await tx.milestone.update({ where: { id: m.id }, data: { writtenOffAt: null, writtenOffById: null, writtenOffReason: null } });
    await recordAudit(tx, { entityType: "Milestone", entityId: m.id, action: "update", actor: user, before: m, after, fields: ["writtenOffAt", "writtenOffReason"], label: m.name, parent: { entityType: "Project", entityId: m.projectId }, note: "write-off undone" });
  });
  revalidateProject(m.projectId);
  return {};
}
