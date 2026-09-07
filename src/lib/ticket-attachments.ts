import "server-only";
import { saveReceiptFile, deleteReceiptFile, isAllowedReceiptType, MAX_RECEIPT_SIZE_BYTES, type SavedReceipt } from "./receipt-storage";

export type IncomingFile = File;
export const MAX_TICKET_FILES = 10;

/** Pull non-empty File entries out of a FormData field. */
export function extractFiles(formData: FormData, field = "files"): File[] {
  return formData.getAll(field).filter((f): f is File => f instanceof File && f.size > 0);
}

/** Validate size + type; returns an error message or null. */
export function validateFiles(files: File[]): string | null {
  if (files.length > MAX_TICKET_FILES) return `Attach at most ${MAX_TICKET_FILES} files at a time.`;
  for (const f of files) {
    if (f.size > MAX_RECEIPT_SIZE_BYTES) return `"${f.name}" is larger than 10MB.`;
    if (!isAllowedReceiptType(f.type)) return `"${f.name}" isn't a supported type (images or PDF).`;
  }
  return null;
}

export async function saveTicketAttachments(files: File[]): Promise<SavedReceipt[]> {
  const out: SavedReceipt[] = [];
  for (const f of files) out.push(await saveReceiptFile(f, "tickets"));
  return out;
}

export async function cleanupSaved(saved: SavedReceipt[]): Promise<void> {
  for (const s of saved) await deleteReceiptFile(s.fileName, "tickets");
}

/** True for image mime types the UI can render inline. */
export function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}
