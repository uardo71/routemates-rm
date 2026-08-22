"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { canManageProject } from "@/lib/permissions";
import { nextProjectNumber } from "@/lib/numbering";
import { applyPlaybookToProject } from "@/lib/playbook";
import { MAX_RECEIPT_SIZE_BYTES, isAllowedReceiptType, saveReceiptFile, deleteReceiptFile } from "@/lib/receipt-storage";

const CreateProjectSchema = z.object({
  name: z.string().min(1, "Name is required"),
  clientId: z.string().min(1, "Client is required"),
  billingType: z.enum(["TIME_AND_MATERIALS", "FIXED_PRICE", "RETAINER"]),
  budgetAmount: z.coerce.number().positive().optional(),
  budgetHours: z.coerce.number().positive().optional(),
  startDate: z.string().optional(),
  managerId: z.string().optional(),
  isInternal: z.boolean(),
  // Program hierarchy: optionally nest this project under a parent "program" (e.g. Tungsten) and
  // name the end customer it delivers to (e.g. Zambon).
  parentProjectId: z.string().optional(),
  endCustomer: z.string().max(200).optional(),
});

export async function createProjectAction(_prevState: string | undefined, formData: FormData) {
  const user = await requirePermission("projects:create");

  const parsed = CreateProjectSchema.safeParse({
    name: formData.get("name"),
    clientId: formData.get("clientId"),
    billingType: formData.get("billingType"),
    budgetAmount: formData.get("budgetAmount") || undefined,
    budgetHours: formData.get("budgetHours") || undefined,
    startDate: formData.get("startDate") || undefined,
    managerId: formData.get("managerId") || undefined,
    isInternal: formData.get("isInternal") === "on",
    parentProjectId: (() => { const v = formData.get("parentProjectId"); return v && v !== "NONE" ? v : undefined; })(),
    endCustomer: formData.get("endCustomer") || undefined,
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";

  const data = parsed.data;
  const managerId = user.role === "PM" ? user.id : data.managerId;
  if (!managerId) return "A project manager is required.";

  let parentProjectId: string | undefined;
  if (data.parentProjectId) {
    const parent = await prisma.project.findFirst({ where: { id: data.parentProjectId, companyId: user.companyId }, select: { id: true } });
    if (!parent) return "Invalid parent project.";
    parentProjectId = parent.id;
  }

  const manager = await prisma.user.findFirst({
    where: { id: managerId, companyId: user.companyId },
  });
  if (!manager) return "Invalid project manager.";

  const client = await prisma.client.findFirst({
    where: { id: data.clientId, companyId: user.companyId },
  });
  if (!client) return "Invalid client.";

  const project = await prisma.project.create({
    data: {
      companyId: user.companyId,
      clientId: client.id,
      name: data.name,
      number: await nextProjectNumber(user.companyId),
      billingType: data.billingType,
      budgetAmount: data.budgetAmount,
      budgetHours: data.budgetHours,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      managerId: manager.id,
      status: "ACTIVE",
      isInternal: data.isInternal,
      parentProjectId,
      endCustomer: data.endCustomer?.trim() || null,
    },
  });
  await applyPlaybookToProject(user.companyId, project.id, project.startDate);

  revalidatePath("/projects");
  redirect(`/projects/${project.id}`);
}

const UpdateProjectSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1, "Name is required"),
  clientId: z.string().min(1, "Client is required"),
  status: z.enum(["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]),
  billingType: z.enum(["TIME_AND_MATERIALS", "FIXED_PRICE", "RETAINER"]),
  budgetAmount: z.coerce.number().positive().optional(),
  budgetHours: z.coerce.number().positive().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  managerId: z.string().optional(),
  isInternal: z.boolean(),
  parentProjectId: z.string().optional(),
  endCustomer: z.string().max(200).optional(),
});

export async function updateProjectAction(_prevState: string | undefined, formData: FormData) {
  const user = await requirePermission("projects:view");
  const projectId = formData.get("projectId");
  if (typeof projectId !== "string") return "Missing project.";
  if (!(await canManageProject(user, projectId))) return "You do not have permission to manage this project.";

  const parsed = UpdateProjectSchema.safeParse({
    projectId,
    name: formData.get("name"),
    clientId: formData.get("clientId"),
    status: formData.get("status"),
    billingType: formData.get("billingType"),
    budgetAmount: formData.get("budgetAmount") || undefined,
    budgetHours: formData.get("budgetHours") || undefined,
    startDate: formData.get("startDate") || undefined,
    endDate: formData.get("endDate") || undefined,
    managerId: formData.get("managerId") || undefined,
    isInternal: formData.get("isInternal") === "on",
    parentProjectId: (() => { const v = formData.get("parentProjectId"); return v && v !== "NONE" ? v : undefined; })(),
    endCustomer: formData.get("endCustomer") || undefined,
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";
  const data = parsed.data;

  const client = await prisma.client.findFirst({ where: { id: data.clientId, companyId: user.companyId } });
  if (!client) return "Invalid client.";

  let managerId: string | undefined;
  if (data.managerId) {
    const manager = await prisma.user.findFirst({ where: { id: data.managerId, companyId: user.companyId } });
    if (!manager) return "Invalid project manager.";
    managerId = manager.id;
  }

  // Resolve the program parent: must belong to the company, can't be the project itself, and can't
  // be one of this project's own sub-projects (no cycles / one level deep).
  let parentProjectId: string | null = null;
  if (data.parentProjectId) {
    if (data.parentProjectId === projectId) return "A project can't be its own program.";
    const parent = await prisma.project.findFirst({ where: { id: data.parentProjectId, companyId: user.companyId }, select: { id: true, parentProjectId: true } });
    if (!parent) return "Invalid program project.";
    if (parent.parentProjectId) return "Pick a top-level program, not a sub-project.";
    const isChild = await prisma.project.findFirst({ where: { id: data.parentProjectId, parentProjectId: projectId }, select: { id: true } });
    if (isChild) return "That project is already a sub-project of this one.";
    parentProjectId = parent.id;
  }

  await prisma.project.update({
    where: { id: projectId },
    data: {
      name: data.name,
      clientId: data.clientId,
      status: data.status,
      billingType: data.billingType,
      budgetAmount: data.budgetAmount ?? null,
      budgetHours: data.budgetHours ?? null,
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      isInternal: data.isInternal,
      parentProjectId,
      endCustomer: data.endCustomer?.trim() || null,
      ...(managerId ? { managerId } : {}),
    },
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}

// ---------- UAT / customer acceptance (phased workflow + history) ----------

const UatAdvanceSchema = z.object({
  projectId: z.string().min(1),
  toStatus: z.enum(["NOT_STARTED", "SENT", "ACCEPTED", "CHANGES_REQUESTED"]),
  note: z.string().max(2000).optional().nullable(),
  signatory: z.string().max(200).optional().nullable(), // only meaningful when moving to ACCEPTED
  acceptedDate: z.string().optional().nullable(),
});
export type AdvanceProjectUatInput = z.infer<typeof UatAdvanceSchema>;

/** Moves the project's UAT to a new phase and logs the transition in its history. Soft signal only —
 *  never blocks anything; invoicing just warns when a project isn't accepted. `uatAccepted` mirrors
 *  the ACCEPTED phase so the badge + invoice warning keep working. */
export async function advanceProjectUatAction(input: AdvanceProjectUatInput): Promise<{ error?: string }> {
  const user = await requirePermission("projects:view");
  const parsed = UatAdvanceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;
  if (!(await canManageProject(user, d.projectId))) return { error: "You do not have permission to manage this project." };

  const project = await prisma.project.findFirst({ where: { id: d.projectId, companyId: user.companyId }, select: { id: true } });
  if (!project) return { error: "Project not found." };

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  const acceptedDate = d.acceptedDate && dateOnly.test(d.acceptedDate) ? new Date(`${d.acceptedDate}T00:00:00.000Z`) : null;
  const accepted = d.toStatus === "ACCEPTED";
  const note = d.note?.trim() || null;

  await prisma.$transaction([
    prisma.project.update({
      where: { id: project.id },
      data: {
        uatStatus: d.toStatus,
        uatAccepted: accepted,
        // Acceptance detail is set on ACCEPTED, cleared when reset to NOT_STARTED, otherwise left as-is.
        ...(accepted
          ? { uatAcceptedDate: acceptedDate, uatSignatory: d.signatory?.trim() || null, uatNotes: note, uatRecordedById: user.id, uatRecordedAt: new Date() }
          : d.toStatus === "NOT_STARTED"
            ? { uatAcceptedDate: null, uatSignatory: null, uatNotes: null, uatRecordedById: null, uatRecordedAt: null }
            : {}),
      },
    }),
    prisma.projectUatEvent.create({ data: { projectId: project.id, status: d.toStatus, note, actorId: user.id } }),
  ]);
  revalidatePath(`/projects/${project.id}`);
  revalidatePath("/projects");
  return {};
}

// ---------- project documents (signed UAT acceptance / other) ----------

const PROJECT_DOC_KINDS = ["UAT_ACCEPTANCE", "OTHER"] as const;
type ProjectDocKind = (typeof PROJECT_DOC_KINDS)[number];

export async function uploadProjectDocumentAction(projectId: string, formData: FormData): Promise<{ error?: string }> {
  const user = await requirePermission("projects:view");
  if (!(await canManageProject(user, projectId))) return { error: "You do not have permission to manage this project." };
  const project = await prisma.project.findFirst({ where: { id: projectId, companyId: user.companyId }, select: { id: true } });
  if (!project) return { error: "Project not found." };

  const kind = String(formData.get("kind") ?? "");
  if (!PROJECT_DOC_KINDS.includes(kind as ProjectDocKind)) return { error: "Invalid document type." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Pick a file to upload." };
  if (file.size > MAX_RECEIPT_SIZE_BYTES) return { error: `File is too large (max ${MAX_RECEIPT_SIZE_BYTES / 1024 / 1024}MB).` };
  if (!isAllowedReceiptType(file.type)) return { error: "Unsupported file type — use a PDF or an image (JPG/PNG/WEBP)." };

  const saved = await saveReceiptFile(file, "documents");
  await prisma.document.create({
    data: { companyId: user.companyId, kind: kind as ProjectDocKind, projectId, uploadedById: user.id, ...saved },
  });
  revalidatePath(`/projects/${projectId}`);
  return {};
}

export async function deleteProjectDocumentAction(documentId: string): Promise<{ error?: string }> {
  const user = await requirePermission("projects:view");
  const doc = await prisma.document.findFirst({ where: { id: documentId, companyId: user.companyId, projectId: { not: null } } });
  if (!doc || !doc.projectId) return { error: "Document not found." };
  if (!(await canManageProject(user, doc.projectId))) return { error: "You do not have permission to manage this project." };

  await prisma.document.delete({ where: { id: doc.id } });
  await deleteReceiptFile(doc.fileName, "documents");
  revalidatePath(`/projects/${doc.projectId}`);
  return {};
}

export async function deleteProjectAction(projectId: string) {
  const user = await requirePermission("projects:view");
  if (!(await canManageProject(user, projectId))) {
    throw new Error("You do not have permission to manage this project.");
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId },
    include: { _count: { select: { milestones: true } } },
  });
  if (!project) throw new Error("Project not found.");
  if (project._count.milestones > 0) {
    throw new Error(`Can't delete — this project has ${project._count.milestones} milestone(s).`);
  }

  await prisma.project.delete({ where: { id: projectId } });
  revalidatePath("/projects");
  redirect("/projects");
}
