import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

// Local filesystem storage, deliberately outside `public/` (never directly URL-reachable —
// always served through the authenticated route at src/app/api/receipts/[fileName]/route.ts)
// and gitignored. Fine for a single-server, ~10-person deployment; would need swapping for
// object storage (S3-compatible) if this ever runs across multiple app instances.
// Files are grouped by subdir under uploads/ — "receipts" (expenses), "documents" (invoice /
// opportunity attachments). Same storage mechanics; only the folder differs.
const UPLOADS_ROOT = path.join(process.cwd(), "uploads");
function uploadDir(subdir: string): string {
  return path.join(UPLOADS_ROOT, subdir);
}

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
  const dir = uploadDir(subdir);
  await mkdir(dir, { recursive: true });
  const ext = path.extname(file.name) || "";
  // Randomized, unrelated to the original name — two people's "receipt.jpg" must never collide,
  // and the on-disk name shouldn't leak the original file name to anyone who isn't authorized.
  const fileName = `${randomUUID()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, fileName), buffer);
  return {
    fileName,
    originalName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: buffer.byteLength,
  };
}

/** Resolves a stored receipt's absolute path — guards against path traversal since `fileName`
 *  ultimately comes from a URL segment on the serving route. */
export function receiptFilePath(fileName: string, subdir = "receipts"): string {
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
    throw new Error("Invalid file name.");
  }
  return path.join(uploadDir(subdir), fileName);
}

export async function deleteReceiptFile(fileName: string, subdir = "receipts"): Promise<void> {
  try {
    await unlink(receiptFilePath(fileName, subdir));
  } catch {
    // Already gone, or never existed — deleting an expense whose file write failed shouldn't
    // itself fail.
  }
}
