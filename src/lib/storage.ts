import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

// Where uploaded files actually live. Two backends behind one interface:
//
//  • Local disk (default) — `uploads/<subdir>/<file>`, outside `public/` and gitignored. Correct
//    for a single machine; it is NOT correct on a PaaS host, where the filesystem is wiped on every
//    restart and redeploy, and is not shared between instances.
//  • Azure Blob — used automatically when AZURE_BLOB_SAS_URL is set. Talks the Blob REST API
//    directly, matching how `graph-mail.ts` and `document-intelligence.ts` call Microsoft services
//    (no SDK, no extra dependency).
//
// Nothing above this module knows which is in play: `receipt-storage.ts` keeps its existing API.

/** Subfolders in use: receipts (expenses), documents (invoice/opportunity/tax/vendor/project),
 *  tickets (comment attachments), avatars (profile photos). */
export type StorageSubdir = string;

const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

/** `fileName` reaches us from a URL segment on the serving routes, so it is validated here — once,
 *  for every backend — rather than trusted by each caller. */
export function assertSafeFileName(fileName: string): void {
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
    throw new Error("Invalid file name.");
  }
}

function assertSafeSubdir(subdir: string): void {
  if (!subdir || subdir.includes("/") || subdir.includes("\\") || subdir.includes("..")) {
    throw new Error("Invalid storage folder.");
  }
}

// ---------- Azure Blob over REST ----------

/** A container-scoped SAS URL, e.g.
 *  `https://<account>.blob.core.windows.net/<container>?sv=...&sig=...`
 *  It must carry create/write/read/delete permissions. Being a SAS it EXPIRES — set a long expiry
 *  and diarise the rotation, or the app silently loses the ability to store files. */
function blobConfig(): { base: string; query: string } | null {
  const raw = process.env.AZURE_BLOB_SAS_URL;
  if (!raw) return null;
  const qi = raw.indexOf("?");
  if (qi < 0) return null; // no SAS token → unusable; fall back to disk rather than fail writes
  return { base: raw.slice(0, qi).replace(/\/+$/, ""), query: raw.slice(qi + 1) };
}

function blobUrl(cfg: { base: string; query: string }, subdir: string, fileName: string): string {
  return `${cfg.base}/${encodeURIComponent(subdir)}/${encodeURIComponent(fileName)}?${cfg.query}`;
}

// ---------- public API ----------

export function usingObjectStorage(): boolean {
  return blobConfig() !== null;
}

export async function putFile(subdir: StorageSubdir, fileName: string, body: Buffer, contentType: string): Promise<void> {
  assertSafeSubdir(subdir);
  assertSafeFileName(fileName);
  const cfg = blobConfig();
  if (!cfg) {
    const dir = path.join(UPLOADS_ROOT, subdir);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, fileName), body);
    return;
  }
  const res = await fetch(blobUrl(cfg, subdir, fileName), {
    method: "PUT",
    headers: {
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": contentType || "application/octet-stream",
      "Content-Length": String(body.byteLength),
    },
    body: new Uint8Array(body),
  });
  if (!res.ok) {
    // Surfaced, not swallowed: a silent upload failure would leave a DB row pointing at nothing.
    throw new Error(`Upload failed (${res.status} ${res.statusText}).`);
  }
}

/** Returns null when the file isn't there, so serve routes can 404 rather than throw. */
export async function getFile(subdir: StorageSubdir, fileName: string): Promise<Buffer | null> {
  assertSafeSubdir(subdir);
  assertSafeFileName(fileName);
  const cfg = blobConfig();
  if (!cfg) {
    try {
      return await readFile(path.join(UPLOADS_ROOT, subdir, fileName));
    } catch {
      return null;
    }
  }
  const res = await fetch(blobUrl(cfg, subdir, fileName));
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

/** Best-effort: deleting a record whose file never stored shouldn't fail the delete. */
export async function removeFile(subdir: StorageSubdir, fileName: string): Promise<void> {
  try {
    assertSafeSubdir(subdir);
    assertSafeFileName(fileName);
  } catch {
    return;
  }
  const cfg = blobConfig();
  if (!cfg) {
    try {
      await unlink(path.join(UPLOADS_ROOT, subdir, fileName));
    } catch {
      // Already gone, or never existed.
    }
    return;
  }
  try {
    await fetch(blobUrl(cfg, subdir, fileName), { method: "DELETE" });
  } catch {
    // Network hiccup on a delete shouldn't block removing the row that referenced it.
  }
}
