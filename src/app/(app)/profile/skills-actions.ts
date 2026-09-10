"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { MAX_RECEIPT_SIZE_BYTES, saveReceiptFile, deleteReceiptFile } from "@/lib/receipt-storage";

// A person's own skills and certifications. Always scoped to the caller — nobody edits someone
// else's profile here (admins see it read-only on /admin/users/[id]).

const utcDate = (s: string | null | undefined): Date | null | "invalid" => {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "invalid";
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
};

function revalidate(userId: string) {
  revalidatePath("/profile");
  revalidatePath("/people");
  revalidatePath("/people/matrix");
  revalidatePath(`/people/${userId}`);
  revalidatePath(`/admin/users/${userId}`);
}

// ---------- skills ----------

const SkillLevelSchema = z.object({
  skillId: z.string().min(1),
  level: z.coerce.number().int().min(1).max(5),
  lastUsedYear: z.coerce.number().int().min(1990).max(2100).optional().nullable(),
});

/** Adds or re-rates one catalogue skill for the caller. */
export async function setMySkillAction(input: z.infer<typeof SkillLevelSchema>): Promise<{ error?: string }> {
  const user = await requireUser();
  const parsed = SkillLevelSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const skill = await prisma.skill.findFirst({ where: { id: parsed.data.skillId, companyId: user.companyId }, select: { id: true } });
  if (!skill) return { error: "That skill is not in the catalogue." };
  await prisma.userSkill.upsert({
    where: { userId_skillId: { userId: user.id, skillId: skill.id } },
    create: { userId: user.id, skillId: skill.id, level: parsed.data.level, lastUsedYear: parsed.data.lastUsedYear ?? null },
    update: { level: parsed.data.level, lastUsedYear: parsed.data.lastUsedYear ?? null },
  });
  revalidate(user.id);
  return {};
}

export async function removeMySkillAction(skillId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  await prisma.userSkill.deleteMany({ where: { userId: user.id, skillId } });
  revalidate(user.id);
  return {};
}

// ---------- certifications ----------

const CertSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Give the certification a name.").max(200),
  issuer: z.string().trim().max(200).optional().nullable(),
  issuedDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
});
export type CertificationInput = z.infer<typeof CertSchema>;

export async function saveMyCertificationAction(input: CertificationInput): Promise<{ error?: string; id?: string }> {
  const user = await requireUser();
  const parsed = CertSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;
  const issuedDate = utcDate(d.issuedDate);
  const expiryDate = utcDate(d.expiryDate);
  if (issuedDate === "invalid") return { error: "Invalid issue date." };
  if (expiryDate === "invalid") return { error: "Invalid expiry date." };
  if (issuedDate && expiryDate && expiryDate < issuedDate) return { error: "Expiry can't be before the issue date." };
  const data = { name: d.name, issuer: d.issuer?.trim() || null, issuedDate, expiryDate };
  let id = d.id;
  if (id) {
    const own = await prisma.certification.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!own) return { error: "Certification not found." };
    await prisma.certification.update({ where: { id }, data });
  } else {
    id = (await prisma.certification.create({ data: { userId: user.id, ...data } })).id;
  }
  revalidate(user.id);
  return { id };
}

export async function deleteMyCertificationAction(id: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const cert = await prisma.certification.findFirst({ where: { id, userId: user.id }, include: { document: { select: { id: true, fileName: true } } } });
  if (!cert) return { error: "Certification not found." };
  await prisma.$transaction(async (tx) => {
    await tx.certification.delete({ where: { id } });
    if (cert.document) await tx.document.delete({ where: { id: cert.document.id } });
  });
  if (cert.document) await deleteReceiptFile(cert.document.fileName, "documents");
  revalidate(user.id);
  return {};
}

const CERT_EXT = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp"]);

/** Attaches (or replaces) the certificate file. Stored like every other Document, kind CERTIFICATE. */
export async function uploadMyCertificateAction(certificationId: string, formData: FormData): Promise<{ error?: string }> {
  const user = await requireUser();
  const cert = await prisma.certification.findFirst({ where: { id: certificationId, userId: user.id }, include: { document: { select: { id: true, fileName: true } } } });
  if (!cert) return { error: "Certification not found." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Pick a file to upload." };
  if (file.size > MAX_RECEIPT_SIZE_BYTES) return { error: `File is too large (max ${MAX_RECEIPT_SIZE_BYTES / 1024 / 1024}MB).` };
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!CERT_EXT.has(ext)) return { error: "Use a PDF or an image." };
  const saved = await saveReceiptFile(file, "documents");
  const old = cert.document;
  await prisma.$transaction(async (tx) => {
    const doc = await tx.document.create({ data: { companyId: user.companyId, kind: "CERTIFICATE", uploadedById: user.id, ...saved } });
    await tx.certification.update({ where: { id: cert.id }, data: { documentId: doc.id } });
    if (old) await tx.document.delete({ where: { id: old.id } });
  });
  if (old) await deleteReceiptFile(old.fileName, "documents");
  revalidate(user.id);
  return {};
}

export async function removeMyCertificateFileAction(certificationId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const cert = await prisma.certification.findFirst({ where: { id: certificationId, userId: user.id }, include: { document: { select: { id: true, fileName: true } } } });
  if (!cert) return { error: "Certification not found." };
  if (!cert.document) return {};
  await prisma.document.delete({ where: { id: cert.document.id } }); // SetNull clears certification.documentId
  await deleteReceiptFile(cert.document.fileName, "documents");
  revalidate(user.id);
  return {};
}
