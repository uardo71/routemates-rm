import "server-only";
import { saveReceiptFile, deleteReceiptFile, type SavedReceipt } from "./receipt-storage";
import { attachmentError } from "./file-types";

export type IncomingFile = File;
export const MAX_TICKET_FILES = 10;

/** Pull non-empty File entries out of a FormData field. */
export function extractFiles(formData: FormData, field = "files"): File[] {
  return formData.getAll(field).filter((f): f is File => f instanceof File && f.size > 0);
}

/** Validate count, size and type (any file except programs and scripts); an error message or null. */
export function validateFiles(files: File[]): string | null {
  return attachmentError(files, MAX_TICKET_FILES);
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
