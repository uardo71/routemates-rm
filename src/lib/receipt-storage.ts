import path from "path";
import { randomUUID } from "crypto";
import { assertSafeFileName, getFile, putFile, removeFile } from "@/lib/storage";

// Upload handling: size/type limits, randomized names, and read/write/delete. WHERE the bytes go is
// decided by `@/lib/storage` — local disk by default, Azure Blob when AZURE_BLOB_SAS_URL is set.
// Files are never placed under `public/`; they are only reachable through the authenticated serve
// routes (api/receipts, api/documents, api/avatars, api/tickets/attachments).
//
// Files are grouped by subdir — "receipts" (expenses), "documents" (invoice / opportunity / tax /
// vendor / project attachments), "tickets" (comment attachments), "avatars" (profile photos).

export const MAX_RECEIPT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB per file

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

export function isAllowedReceiptType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.has(mimeType);
}

export type SavedReceipt = {
  fileName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

export async function saveReceiptFile(file: File, subdir = "receipts"): Promise<SavedReceipt> {
  const ext = path.extname(file.name) || "";
  // Randomized, unrelated to the original name — two people's "receipt.jpg" must never collide,
  // and the stored name shouldn't leak the original file name to anyone who isn't authorized.
  const fileName = `${randomUUID()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  await putFile(subdir, fileName, buffer, mimeType);
  return { fileName, originalName: file.name, mimeType, sizeBytes: buffer.byteLength };
}

/** Reads a stored file, or null when it isn't there. Use this from serve routes instead of
 *  reading from disk directly, so they work whichever backend is configured. */
export async function readReceiptFile(fileName: string, subdir = "receipts"): Promise<Buffer | null> {
  assertSafeFileName(fileName);
  return getFile(subdir, fileName);
}

export async function deleteReceiptFile(fileName: string, subdir = "receipts"): Promise<void> {
  await removeFile(subdir, fileName);
}
