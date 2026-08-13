"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import {
  MAX_RECEIPT_SIZE_BYTES,
  isAllowedReceiptType,
  saveReceiptFile,
  deleteReceiptFile,
} from "@/lib/receipt-storage";

export type ProfileFormState = { error?: string; ok?: boolean };

const UpdateProfileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name is too long"),
  title: z.string().trim().max(120, "Title is too long").optional(),
  phone: z.string().trim().max(40, "Phone is too long").optional(),
  location: z.string().trim().max(120, "Location is too long").optional(),
  bio: z.string().trim().max(500, "Bio is too long (max 500 characters)").optional(),
});

const orNull = (v?: string) => {
  const t = v?.trim();
  return t ? t : null;
};

/** A user editing their OWN profile — always scoped to the caller's id, so there's nothing to
 *  authorize beyond being signed in, and email / password / role can never be touched here. */
export async function updateProfileAction(
  _prev: ProfileFormState | undefined,
  formData: FormData
): Promise<ProfileFormState> {
  const user = await requireUser();

  const parsed = UpdateProfileSchema.safeParse({
    name: formData.get("name"),
    title: formData.get("title") ?? undefined,
    phone: formData.get("phone") ?? undefined,
    location: formData.get("location") ?? undefined,
    bio: formData.get("bio") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      name: d.name,
      title: orNull(d.title),
      phone: orNull(d.phone),
      location: orNull(d.location),
      bio: orNull(d.bio),
    },
  });

  revalidatePath("/profile");
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${user.id}`);
  return { ok: true };
}

export async function uploadAvatarAction(
  _prev: ProfileFormState | undefined,
  formData: FormData
): Promise<ProfileFormState> {
  const user = await requireUser();

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image to upload." };
  if (file.size > MAX_RECEIPT_SIZE_BYTES) {
    return { error: `Image is too large (max ${MAX_RECEIPT_SIZE_BYTES / 1024 / 1024}MB).` };
  }
  if (!isAllowedReceiptType(file.type) || !file.type.startsWith("image/")) {
    return { error: "Unsupported file — use a JPG, PNG, WEBP, or HEIC image." };
  }

  const existing = await prisma.user.findUnique({ where: { id: user.id }, select: { avatarUrl: true } });
  const saved = await saveReceiptFile(file, "avatars");
  await prisma.user.update({ where: { id: user.id }, data: { avatarUrl: saved.fileName } });

  // Best-effort cleanup of the file we just replaced (after the DB points at the new one).
  if (existing?.avatarUrl) await deleteReceiptFile(existing.avatarUrl, "avatars");

  revalidatePath("/profile");
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${user.id}`);
  return { ok: true };
}

export async function removeAvatarAction(): Promise<void> {
  const user = await requireUser();
  const existing = await prisma.user.findUnique({ where: { id: user.id }, select: { avatarUrl: true } });
  if (!existing?.avatarUrl) return;

  await prisma.user.update({ where: { id: user.id }, data: { avatarUrl: null } });
  await deleteReceiptFile(existing.avatarUrl, "avatars");

  revalidatePath("/profile");
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${user.id}`);
}
